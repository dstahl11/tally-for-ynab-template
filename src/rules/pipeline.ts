import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { accounts, categories, queueItems, rules, settings, transactions, writeLog } from '../db/schema.js';
import { syncHealthy } from '../sync/service.js';
import { WriteGateway } from '../proposals/writeGateway.js';

export interface PipelineResult { skipped: string[]; routed: string[]; approved: string[]; queued: string[]; }

export interface ApprovalSettings {
  enabled: boolean;
  mode: 'review' | 'automatic';
  minHistory: number;
  consistencyPercent: number;
  standardDeviations: number;
  maxPerRun: number;
}

export const DEFAULT_APPROVAL_SETTINGS: ApprovalSettings = {
  enabled: true,
  mode: 'automatic',
  minHistory: 5,
  consistencyPercent: 90,
  standardDeviations: 2,
  maxPerRun: 100,
};

type ApprovalEvaluation = {
  eligible: boolean;
  reason: string;
  historyCount: number;
  consistencyPercent: number;
  amountLimitMilli: number | null;
};

export class TransactionPipeline {
  constructor(private readonly database: AppDatabase, private readonly writes: WriteGateway) {}

  approvalSettings(): ApprovalSettings {
    const stored = this.database.db.select().from(settings).where(eq(settings.key, 'approval_assistant')).get()?.value as Partial<ApprovalSettings> | undefined;
    return { ...DEFAULT_APPROVAL_SETTINGS, ...(stored ?? {}) };
  }

  setApprovalSettings(value: ApprovalSettings, actor: string): ApprovalSettings {
    this.database.db.insert(settings).values({ key: 'approval_assistant', value, updatedAt: new Date().toISOString(), updatedBy: actor })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date().toISOString(), updatedBy: actor } }).run();
    return value;
  }

  approvalStatus(limit = 10) {
    const config = this.approvalSettings();
    const pending = this.database.db.select().from(transactions)
      .where(and(eq(transactions.approved, false), eq(transactions.deleted, false), sql`${transactions.categoryId} is not null`))
      .orderBy(desc(transactions.date)).limit(limit).all()
      .map((transaction) => ({
        transaction: { id: transaction.id, date: transaction.date, payeeName: transaction.payeeName ?? transaction.importPayeeNameOriginal ?? 'Unknown merchant', categoryName: transaction.categoryName ?? 'Uncategorized', amountMilli: transaction.amountMilli, accountName: transaction.accountName },
        evaluation: this.evaluate(transaction, config),
      }));
    const recent = this.database.db.select().from(writeLog).orderBy(desc(writeLog.id)).limit(100).all().flatMap((write) => {
      if (!['approval-assistant', 'system-auto'].includes(write.actor)) return [];
      const requested = write.request as { transactions?: Array<{ id?: string; approved?: boolean }> };
      const approved = requested.transactions?.find((row) => row.approved === true && row.id);
      if (!approved?.id) return [];
      const transaction = this.database.db.select().from(transactions).where(eq(transactions.id, approved.id)).get();
      return [{ id: write.id, at: write.at, dryRun: write.dryRun, responseStatus: write.responseStatus, transaction: transaction ? { id: transaction.id, date: transaction.date, payeeName: transaction.payeeName ?? transaction.importPayeeNameOriginal ?? 'Unknown merchant', categoryName: transaction.categoryName ?? 'Uncategorized', amountMilli: transaction.amountMilli } : null }];
    }).slice(0, limit);
    return { settings: config, pending, recent };
  }

  private retireResolvedQueueItems() {
    const resolved = this.database.db.select({ item: queueItems, transaction: transactions }).from(queueItems).innerJoin(transactions, eq(transactions.id, queueItems.transactionId))
      .where(sql`${queueItems.state} in ('pending','retry') and (${transactions.categoryId} is not null or ${transactions.approved} = 1 or ${transactions.deleted} = 1)`).all();
    const answeredAt = new Date().toISOString();
    for (const { item, transaction } of resolved) {
      this.database.db.update(queueItems).set({ state: 'answered', answerCategoryId: transaction.categoryId, answeredAt, retryAt: null })
        .where(eq(queueItems.transactionId, item.transactionId)).run();
    }
  }

  async process(transactionIds: string[]): Promise<PipelineResult> {
    const result: PipelineResult = { skipped: [], routed: [], approved: [], queued: [] };
    this.retireResolvedQueueItems();
    if (!syncHealthy(this.database) || !transactionIds.length) return result;
    const rows = this.database.db.select().from(transactions).where(inArray(transactions.id, transactionIds)).all();
    const activeRules = this.database.db.select().from(rules).where(eq(rules.enabled, true)).orderBy(rules.priority).all();
    for (const transaction of rows) {
      if (transaction.deleted) continue;
      if (transaction.transferAccountId) {
        const counterparty = this.database.db.select().from(accounts).where(eq(accounts.id, transaction.transferAccountId)).get();
        if (counterparty?.onBudget) { result.skipped.push(transaction.id); continue; }
      }
      if ((transaction.categoryName ?? '').toLowerCase().includes('credit card payment')) { result.skipped.push(transaction.id); continue; }

      let routedThisCycle = false;
      if (!transaction.categoryId) {
        for (const rule of activeRules) {
          const candidate = rule.matchField === 'payee_norm' ? transaction.payeeNorm ?? '' : transaction.importPayeeNameOriginal ?? '';
          const primary = rule.matchType === 'prefix' ? candidate.startsWith(rule.pattern) : rule.matchType === 'regex' ? new RegExp(rule.pattern, 'i').test(candidate) : candidate.includes(rule.pattern);
          if (!primary || (rule.secondaryPattern && !candidate.includes(rule.secondaryPattern))) continue;
          if (rule.action.categoryName || rule.action.categoryId) {
            const destination = rule.action.categoryId
              ? this.database.db.select().from(categories).where(eq(categories.id, rule.action.categoryId)).get()
              : this.database.db.select().from(categories).where(sql`lower(${categories.name}) = lower(${rule.action.categoryName!}) and ${categories.deleted} = 0`).get();
            if (destination) {
              await this.writes.mutate('system-auto', '/transactions', { transactions: [{ id: transaction.id, category_id: destination.id }] }, { transactionId: transaction.id, priorCategoryId: null });
              this.database.db.update(transactions).set({ categoryId: destination.id, categoryName: destination.name }).where(eq(transactions.id, transaction.id)).run();
              this.database.db.update(rules).set({ hitCount: rule.hitCount + 1 }).where(eq(rules.id, rule.id)).run();
              result.routed.push(transaction.id); routedThisCycle = true;
            }
          }
          break;
        }
      }

      const current = this.database.db.select().from(transactions).where(eq(transactions.id, transaction.id)).get()!;
      const approval = this.approvalSettings();
      const evaluation = this.evaluate(current, approval);
      const canApprove = approval.enabled && approval.mode === 'automatic' && !routedThisCycle && evaluation.eligible;
      if (canApprove && result.approved.length < approval.maxPerRun) {
        await this.writes.mutate('approval-assistant', '/transactions', { transactions: [{ id: current.id, approved: true }] }, { transactionId: current.id, approved: false });
        this.database.db.update(transactions).set({ approved: true }).where(eq(transactions.id, current.id)).run();
        result.approved.push(current.id);
      } else if (!current.approved && !current.categoryId && current.accountName === 'Member') {
        this.database.db.insert(queueItems).values({ transactionId: current.id, state: 'pending', suggestions: this.historicalSuggestions(current.payeeNorm) }).onConflictDoNothing().run();
        result.queued.push(current.id);
      }
    }
    return result;
  }

  private evaluate(transaction: typeof transactions.$inferSelect, config: ApprovalSettings): ApprovalEvaluation {
    if (transaction.isSplit) return { eligible: false, reason: 'Split purchase requires review', historyCount: 0, consistencyPercent: 0, amountLimitMilli: null };
    if (!transaction.categoryId) return { eligible: false, reason: 'Category is missing', historyCount: 0, consistencyPercent: 0, amountLimitMilli: null };
    if (!transaction.payeeNorm) return { eligible: false, reason: 'Merchant history is unavailable', historyCount: 0, consistencyPercent: 0, amountLimitMilli: null };
    const history = this.database.db.select({ categoryId: transactions.categoryId, amount: transactions.amountMilli }).from(transactions)
      .where(and(eq(transactions.payeeNorm, transaction.payeeNorm), eq(transactions.approved, true), eq(transactions.deleted, false))).all();
    if (history.length < config.minHistory) return { eligible: false, reason: `Needs ${config.minHistory - history.length} more approved purchase${config.minHistory - history.length === 1 ? '' : 's'} from this merchant`, historyCount: history.length, consistencyPercent: 0, amountLimitMilli: null };
    const same = history.filter((row) => row.categoryId === transaction.categoryId).length / history.length;
    const amounts = history.map((row) => Math.abs(row.amount));
    const mean = amounts.reduce((sum, value) => sum + value, 0) / amounts.length;
    const deviation = Math.sqrt(amounts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / amounts.length);
    const amountLimitMilli = Math.round(mean + config.standardDeviations * deviation);
    const consistencyPercent = Math.round(same * 100);
    if (consistencyPercent < config.consistencyPercent) return { eligible: false, reason: `Category matches only ${consistencyPercent}% of this merchant's history`, historyCount: history.length, consistencyPercent, amountLimitMilli };
    if (Math.abs(transaction.amountMilli) > amountLimitMilli) return { eligible: false, reason: 'Amount is outside this merchant’s normal range', historyCount: history.length, consistencyPercent, amountLimitMilli };
    return { eligible: true, reason: `${history.length} prior purchases · ${consistencyPercent}% category match`, historyCount: history.length, consistencyPercent, amountLimitMilli };
  }

  private historicalSuggestions(payeeNorm: string | null) {
    if (!payeeNorm) return [{ categoryId: null, label: '❓ Unknown', source: 'static' }];
    const rows = this.database.db.select({ categoryId: transactions.categoryId, categoryName: transactions.categoryName, count: sql<number>`count(*)` })
      .from(transactions).where(and(eq(transactions.payeeNorm, payeeNorm), sql`${transactions.categoryId} is not null`))
      .groupBy(transactions.categoryId, transactions.categoryName).orderBy(sql`count(*) desc`).limit(2).all();
    return [...rows.map((row) => ({ categoryId: row.categoryId, label: row.categoryName ?? 'Category', source: 'history' })), { categoryId: null, label: '❓ Unknown', source: 'static' }];
  }
}
