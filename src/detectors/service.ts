import { and, asc, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { categories, categoryMonths, overrides, proposals, rules, settings, transactions, users } from '../db/schema.js';
import { ProposalService } from '../proposals/service.js';
import { placeholderTarget, subscriptionCreep } from './rules.js';

interface ThresholdSettings { reimbursementFloatCategories: string[]; }
export class DetectorService {
  constructor(private readonly database: AppDatabase, private readonly proposalService: ProposalService) {}

  async runWeekly() {
    const config = this.database.db.select().from(settings).where(eq(settings.key, 'thresholds')).get()?.value as ThresholdSettings;
    const excluded = new Set((config?.reimbursementFloatCategories ?? []).map((name) => name.toLowerCase()));
    const activeCategories = this.database.db.select().from(categories).where(and(eq(categories.hidden, false), eq(categories.deleted, false))).all();
    const emitted: string[] = [];
    for (const category of activeCategories) {
      if (excluded.has(category.name.toLowerCase()) || this.hasOpenProposal(category.id)) continue;
      const categoryTransactions = this.database.db.select().from(transactions).where(and(eq(transactions.categoryId, category.id), eq(transactions.deleted, false))).orderBy(asc(transactions.date)).all();
      const byPayee = new Map<string, number[]>();
      for (const transaction of categoryTransactions) {
        if (!transaction.payeeNorm) continue;
        byPayee.set(transaction.payeeNorm, [...(byPayee.get(transaction.payeeNorm) ?? []), transaction.amountMilli]);
      }
      let suggested: number | null = null; let reason = '';
      if (category.goalTargetMilli) {
        for (const [payee, charges] of byPayee) {
          suggested = subscriptionCreep(category.goalTargetMilli, charges);
          if (suggested) { reason = `${payee} charged the same higher amount 3 times`; break; }
        }
        if (!suggested) {
          const activities = this.database.db.select({ activity: categoryMonths.activityMilli }).from(categoryMonths).where(eq(categoryMonths.categoryId, category.id)).orderBy(asc(categoryMonths.month)).all().map((row) => row.activity);
          suggested = placeholderTarget(category.goalTargetMilli, activities); if (suggested) reason = 'Recent activity is consistently above the target';
        }
      } else {
        const activities = this.database.db.select({ activity: categoryMonths.activityMilli }).from(categoryMonths).where(eq(categoryMonths.categoryId, category.id)).orderBy(asc(categoryMonths.month)).all().slice(-4).map((row) => Math.abs(row.activity));
        if (activities.filter((value) => value >= 50000).length >= 3) {
          const sorted = [...activities].sort((a, b) => a - b); suggested = Math.ceil(sorted[Math.floor(sorted.length / 2)] / 10000) * 10000; reason = 'Real spending in at least 3 of the last 4 months';
        }
      }
      if (suggested) emitted.push(await this.proposalService.create('target_change', {
        categoryId: category.id,
        writes: [{ endpoint: `/categories/${category.id}`, request: { category: { goal_target: suggested } }, reversalHint: { goal_target: category.goalTargetMilli } }],
      }, `TARGET ${category.name}: $${((category.goalTargetMilli ?? 0) / 1000).toFixed(0)} → $${(suggested / 1000).toFixed(0)}. ${reason}`));
    }
    this.learnOverrideRules();
    emitted.push(...await this.detectNewRecurring());
    return emitted;
  }

  private async detectNewRecurring() {
    const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const rows = this.database.db.select().from(transactions).where(and(eq(transactions.deleted, false), sql`${transactions.payeeNorm} is not null`, sql`${transactions.date} >= ${since}`)).orderBy(asc(transactions.date)).all();
    const groups = new Map<string, typeof rows>();
    for (const row of rows) groups.set(row.payeeNorm!, [...(groups.get(row.payeeNorm!) ?? []), row]);
    const emitted: string[] = [];
    for (const [payeeNorm, items] of groups) {
      if (items.length < 2 || items.some((item) => item.categoryId) || this.database.db.select().from(rules).where(and(eq(rules.enabled, true), eq(rules.matchField, 'payee_norm'), eq(rules.pattern, payeeNorm))).get()) continue;
      if (this.database.db.select().from(proposals).where(eq(proposals.status, 'open')).all().some((proposal) => (proposal.payload as any).newRecurring?.payeeNorm === payeeNorm)) continue;
      const gap = Math.round((new Date(items.at(-1)!.date).getTime() - new Date(items.at(-2)!.date).getTime()) / 86400000);
      if (gap < 20 || gap > 40) continue;
      const amounts = items.map((item) => Math.abs(item.amountMilli)).sort((a, b) => a - b); const targetMilli = amounts[Math.floor(amounts.length / 2)];
      const memberAccountId = this.database.db.select({ accountId: users.accountId }).from(users).where(eq(users.role, 'member')).get()?.accountId;
      const groupName = memberAccountId && items.some((item) => item.accountId === memberAccountId) ? 'Member Categories' : 'Unexpected';
      const destination = this.database.db.select({ id: categories.groupId }).from(categories).where(and(eq(categories.groupName, groupName), eq(categories.deleted, false))).get()
        ?? this.database.db.select({ id: categories.groupId }).from(categories).where(eq(categories.deleted, false)).get();
      if (!destination) continue;
      const displayBase = items.at(-1)?.payeeName ?? payeeNorm;
      const name = displayBase.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 50);
      emitted.push(await this.proposalService.create('new_category', { newRecurring: { categoryGroupId: destination.id, name, targetMilli, note: 'Auto-detected recurring expense; approved by proposal.', transactionIds: items.map((item) => item.id), payeeNorm } }, `NEW RECURRING: ${name}, about $${(targetMilli / 1000).toFixed(0)} every ${gap} days. Create category, target, backfill, and rule?`));
    }
    return emitted;
  }

  private hasOpenProposal(categoryId: string) {
    return this.database.db.select().from(proposals).where(eq(proposals.status, 'open')).all().some((proposal) => (proposal.payload as any).categoryId === categoryId);
  }

  learnOverrideRules() {
    const grouped = this.database.db.select({ payeeNorm: transactions.payeeNorm, toCategoryId: overrides.toCategoryId, count: sql<number>`count(*)` })
      .from(overrides).innerJoin(transactions, eq(transactions.id, overrides.transactionId)).where(sql`${transactions.payeeNorm} is not null`)
      .groupBy(transactions.payeeNorm, overrides.toCategoryId).having(sql`count(*) >= 2`).all();
    let created = 0;
    for (const row of grouped) {
      const exists = this.database.db.select().from(rules).where(and(eq(rules.kind, 'payee_category'), eq(rules.matchField, 'payee_norm'), eq(rules.pattern, row.payeeNorm!))).get();
      if (!exists) {
        this.database.db.insert(rules).values({ kind: 'payee_category', matchField: 'payee_norm', matchType: 'contains', pattern: row.payeeNorm!, action: { categoryId: row.toCategoryId }, priority: 80, enabled: true, createdBy: 'override', hitCount: 0, createdAt: new Date().toISOString() }).run(); created++;
      }
    }
    return created;
  }
}
