import Anthropic from '@anthropic-ai/sdk';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../config/env.js';
import type { AppDatabase } from '../db/client.js';
import { categories, queueItems, transactions, users } from '../db/schema.js';
import { visibleScope } from '../auth/scope.js';
import { parseModelJson } from '../ai/modelJson.js';

const resultSchema = z.array(z.object({
  transaction_id: z.string(),
  suggestions: z.array(z.object({ category_id: z.string(), confidence: z.number().min(0).max(1), blurb: z.string().max(120) })).min(1).max(3),
})).max(10);

const LOOKUP_VERSION = 3;
type CategoryChoice = { id: string; name: string };

export class NovelCategorizer {
  private readonly anthropic?: Anthropic;
  constructor(private readonly database: AppDatabase, private readonly env: AppEnv) {
    if (!env.MOCK_EXTERNALS && env.ANTHROPIC_API_KEY) this.anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  async run(options: { refreshMissing?: boolean } = {}) {
    const member = this.database.db.select().from(users).where(eq(users.role, 'member')).get();
    if (!member) return 0;
    const scope = visibleScope(member);
    const batch = this.database.db.select({ item: queueItems, transaction: transactions }).from(queueItems).innerJoin(transactions, eq(transactions.id, queueItems.transactionId))
      .where(and(scope.transactionPredicate, sql`${queueItems.state} in ('pending','retry')`)).all().filter(({ item }) => {
        const enrichment = item.enrichment as any;
        const stale = enrichment?.lookupVersion !== LOOKUP_VERSION;
        return options.refreshMissing ? stale || !item.suggestions.some((suggestion) => suggestion.categoryId) : stale || !enrichment?.lookupComplete;
      }).slice(0, 10);
    if (!batch.length) return 0;
    const categoryRows = this.database.db.select({ id: categories.id, name: categories.name, group: categories.groupName, note: categories.note }).from(categories).where(and(scope.categoryPredicate, eq(categories.hidden, false), eq(categories.deleted, false))).all();
    let results: z.infer<typeof resultSchema>;
    if (this.env.MOCK_EXTERNALS || !this.anthropic) {
      results = batch.map(({ transaction }) => {
        const text = `${transaction.payeeName} ${transaction.importPayeeNameOriginal}`.toLowerCase();
        const ranked = [...categoryRows].sort((left, right) => {
          const score = (category: typeof left) => category.name.toLowerCase().split(/\W+/).filter((token) => token.length > 3 && text.includes(token)).length
            + (text.includes('cafe') && category.name.toLowerCase().includes('food') ? 3 : 0)
            + (text.includes('market') && category.name.toLowerCase().includes('clothing') ? 2 : 0);
          return score(right) - score(left);
        }).slice(0, 3);
        return { transaction_id: transaction.id, suggestions: ranked.map((category, index) => ({ category_id: category.id, confidence: index === 0 ? .62 : .42 - index * .08, blurb: `Best visible-category fit for this merchant: ${category.name}` })) };
      });
    } else {
      const response = await this.anthropic.messages.create({
        model: this.env.ANTHROPIC_MODEL, max_tokens: 1024,
        system: `Classify statement merchants using the descriptor, general merchant knowledge, and only these member-visible categories: ${JSON.stringify(categoryRows)}. For every transaction_id, return 1 to 3 ranked plausible choices even when confidence is low. Never invent a category id and never omit a transaction. Return only strict JSON: [{"transaction_id":string,"suggestions":[{"category_id":string,"confidence":number,"blurb":string}]}]. The blurb should briefly explain the merchant clue. No prose or Markdown.`,
        messages: [{ role: 'user', content: JSON.stringify(batch.map(({ transaction }) => ({ transaction_id: transaction.id, normalized_payee: transaction.payeeNorm, statement_descriptor: transaction.importPayeeNameOriginal, amount_milli: transaction.amountMilli }))) }],
      });
      results = parseModelJson(response.content.find((block) => block.type === 'text')?.text ?? '[]', resultSchema);
    }
    for (const { item, transaction } of batch) {
      const result = results.find((candidate) => candidate.transaction_id === transaction.id);
      const modelSuggestions = (result?.suggestions ?? []).flatMap((candidate) => {
        const category = categoryRows.find((row) => row.id === candidate.category_id);
        return category ? [{ categoryId: category.id, label: category.name, source: 'lookup' }] : [];
      });
      const merged = [...modelSuggestions, ...item.suggestions].filter((suggestion, index, all) => suggestion.categoryId && all.findIndex((candidate) => candidate.categoryId === suggestion.categoryId) === index).slice(0, 3);
      const first = result?.suggestions.find((candidate) => candidate.category_id === merged[0]?.categoryId);
      this.database.db.update(queueItems).set({ suggestions: merged, enrichment: { lookupComplete: true, lookupVersion: LOOKUP_VERSION, source: 'ai-lookup', confidence: first?.confidence ?? 0, blurb: first?.blurb ?? 'Ranked from merchant and visible-category clues' } }).where(eq(queueItems.transactionId, item.transactionId)).run();
    }
    return batch.length;
  }
}
