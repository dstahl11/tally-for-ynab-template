import { and, eq, gte, sql } from 'drizzle-orm';
import type { AppEnv } from '../config/env.js';
import type { AppDatabase } from '../db/client.js';
import { accounts, categories, categoryMonths, payees, settings, syncState, transactions } from '../db/schema.js';
import { normalizePayee } from '../rules/normalize.js';
import type { Messenger } from '../services/messages.js';
import type { YnabClient, YnabTransaction } from '../types/ynab.js';
import { monthKeyInTimeZone, shiftMonth } from '../time.js';

export interface SyncResult { ok: boolean; sinceDate: string; localUnapproved: number; remoteUnapproved: number; changedTransactionIds: string[]; }

export function historyStartDate(months: number, now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return date.toISOString().slice(0, 10);
}

export class SyncService {
  constructor(
    private readonly database: AppDatabase,
    private readonly ynab: YnabClient,
    private readonly messenger: Messenger,
    private readonly env: AppEnv,
  ) {}

  private knowledge(resource: string): number {
    return this.database.db.select().from(syncState).where(eq(syncState.resource, resource)).get()?.serverKnowledge ?? 0;
  }

  private mark(resource: string, knowledge: number, at: string) {
    this.database.db.insert(syncState).values({ resource, serverKnowledge: knowledge, lastSyncedAt: at, status: 'ok' })
      .onConflictDoUpdate({ target: syncState.resource, set: { serverKnowledge: knowledge, lastSyncedAt: at, status: 'ok', detail: null } }).run();
  }

  private storeTransactions(rows: YnabTransaction[], at: string, changedTransactionIds: string[], detectChanges = false) {
    const existing = detectChanges
      ? new Map(this.database.db.select({
        id: transactions.id, date: transactions.date, amountMilli: transactions.amountMilli,
        payeeId: transactions.payeeId, payeeName: transactions.payeeName,
        importPayeeName: transactions.importPayeeName, importPayeeNameOriginal: transactions.importPayeeNameOriginal,
        categoryId: transactions.categoryId, categoryName: transactions.categoryName,
        accountId: transactions.accountId, accountName: transactions.accountName, memo: transactions.memo,
        approved: transactions.approved, cleared: transactions.cleared,
        transferAccountId: transactions.transferAccountId, transferTransactionId: transactions.transferTransactionId,
        matchedTransactionId: transactions.matchedTransactionId, isSplit: transactions.isSplit, deleted: transactions.deleted,
      }).from(transactions).all().map((row) => [row.id, row]))
      : null;
    for (const row of rows) {
      const current = existing?.get(row.id);
      const changed = !current
        || current.date !== row.date || current.amountMilli !== row.amount
        || current.payeeId !== (row.payee_id ?? null) || current.payeeName !== (row.payee_name ?? null)
        || current.importPayeeName !== (row.import_payee_name ?? null) || current.importPayeeNameOriginal !== (row.import_payee_name_original ?? null)
        || current.categoryId !== (row.category_id ?? null) || current.categoryName !== (row.category_name ?? null)
        || current.accountId !== row.account_id || current.accountName !== row.account_name || current.memo !== (row.memo ?? null)
        || current.approved !== row.approved || current.cleared !== row.cleared
        || current.transferAccountId !== (row.transfer_account_id ?? null) || current.transferTransactionId !== (row.transfer_transaction_id ?? null)
        || current.matchedTransactionId !== (row.matched_transaction_id ?? null) || current.isSplit !== Boolean(row.subtransactions?.length)
        || current.deleted !== row.deleted;
      if (!existing || changed) changedTransactionIds.push(row.id);
      const rawPayee = row.import_payee_name_original ?? row.import_payee_name ?? row.payee_name;
      this.database.db.insert(transactions).values({
        id: row.id, date: row.date, amountMilli: row.amount, payeeId: row.payee_id ?? null, payeeName: row.payee_name ?? null,
        payeeNorm: normalizePayee(rawPayee), importPayeeName: row.import_payee_name ?? null,
        importPayeeNameOriginal: row.import_payee_name_original ?? null, categoryId: row.category_id ?? null,
        categoryName: row.category_name ?? null, accountId: row.account_id, accountName: row.account_name, memo: row.memo ?? null,
        approved: row.approved, cleared: row.cleared, transferAccountId: row.transfer_account_id ?? null,
        transferTransactionId: row.transfer_transaction_id ?? null, matchedTransactionId: row.matched_transaction_id ?? null,
        isSplit: Boolean(row.subtransactions?.length), deleted: row.deleted, raw: row, syncedAt: at,
      }).onConflictDoUpdate({ target: transactions.id, set: {
        date: row.date, amountMilli: row.amount, payeeId: row.payee_id ?? null, payeeName: row.payee_name ?? null,
        payeeNorm: normalizePayee(rawPayee), importPayeeName: row.import_payee_name ?? null,
        importPayeeNameOriginal: row.import_payee_name_original ?? null, categoryId: row.category_id ?? null,
        categoryName: row.category_name ?? null, accountId: row.account_id, accountName: row.account_name, memo: row.memo ?? null,
        approved: row.approved, cleared: row.cleared, transferAccountId: row.transfer_account_id ?? null,
        transferTransactionId: row.transfer_transaction_id ?? null, matchedTransactionId: row.matched_transaction_id ?? null,
        isSplit: Boolean(row.subtransactions?.length), deleted: row.deleted, raw: row, syncedAt: at,
      } }).run();
    }
  }

  private localUnapprovedCount(sinceDate: string): number {
    return this.env.DRY_RUN
      ? this.database.db.select({ raw: transactions.raw }).from(transactions).where(and(gte(transactions.date, sinceDate), eq(transactions.deleted, false))).all()
        .filter((row) => !(row.raw as { approved?: boolean }).approved).length
      : this.database.db.select({ count: sql<number>`count(*)` }).from(transactions)
        .where(sql`${transactions.date} >= ${sinceDate} and ${transactions.approved} = 0 and ${transactions.deleted} = 0`).get()!.count;
  }

  async run(): Promise<SyncResult> {
    const at = new Date().toISOString();
    const sinceDate = historyStartDate(this.env.HISTORY_MONTHS);
    const changedTransactionIds: string[] = [];
    try {
      const accountDelta = await this.ynab.accounts(this.knowledge('accounts'));
      this.database.sqlite.transaction(() => {
        for (const row of accountDelta.items) this.database.db.insert(accounts).values({ id: row.id, name: row.name, onBudget: row.on_budget, closed: row.closed, deleted: row.deleted, raw: row, syncedAt: at })
          .onConflictDoUpdate({ target: accounts.id, set: { name: row.name, onBudget: row.on_budget, closed: row.closed, deleted: row.deleted, raw: row, syncedAt: at } }).run();
        this.mark('accounts', accountDelta.serverKnowledge, at);
      })();

      const payeeDelta = await this.ynab.payees(this.knowledge('payees'));
      this.database.sqlite.transaction(() => {
        for (const row of payeeDelta.items) this.database.db.insert(payees).values({ id: row.id, name: row.name, deleted: row.deleted, raw: row, syncedAt: at })
          .onConflictDoUpdate({ target: payees.id, set: { name: row.name, deleted: row.deleted, raw: row, syncedAt: at } }).run();
        this.mark('payees', payeeDelta.serverKnowledge, at);
      })();

      const categoryDelta = await this.ynab.categories(this.knowledge('categories'));
      this.database.sqlite.transaction(() => {
        for (const row of categoryDelta.items) this.database.db.insert(categories).values({
          id: row.id, groupId: row.category_group_id, groupName: row.category_group_name, name: row.name,
          hidden: row.hidden, deleted: row.deleted, note: row.note ?? null, goalType: row.goal_type ?? null,
          goalTargetMilli: row.goal_target ?? null, goalTargetDate: row.goal_target_date ?? null, raw: row, syncedAt: at,
        }).onConflictDoUpdate({ target: categories.id, set: {
          groupId: row.category_group_id, groupName: row.category_group_name, name: row.name, hidden: row.hidden,
          deleted: row.deleted, note: row.note ?? null, goalType: row.goal_type ?? null,
          goalTargetMilli: row.goal_target ?? null, goalTargetDate: row.goal_target_date ?? null, raw: row, syncedAt: at,
        } }).run();
        this.mark('categories', categoryDelta.serverKnowledge, at);
        const essentialSetting = this.database.db.select().from(settings).where(eq(settings.key, 'essentials_category_names')).get();
        if (essentialSetting) {
          const activeNames = new Set(this.database.db.select({ name: categories.name }).from(categories).where(and(eq(categories.hidden, false), eq(categories.deleted, false))).all().map((row) => row.name));
          const selected = (essentialSetting.value as string[]).filter((name) => activeNames.has(name));
          if (selected.length !== (essentialSetting.value as string[]).length) this.database.db.update(settings).set({ value: selected, updatedAt: at, updatedBy: 'sync' }).where(eq(settings.key, 'essentials_category_names')).run();
        }
      })();

      const currentMonth = monthKeyInTimeZone(this.env.TIMEZONE);
      for (const month of [currentMonth, shiftMonth(currentMonth, -1)]) {
        const delta = await this.ynab.month(month, this.knowledge(`month:${month}`));
        this.database.sqlite.transaction(() => {
          for (const row of delta.items) {
            this.database.db.insert(categoryMonths).values({ categoryId: row.id, month, budgetedMilli: row.budgeted ?? 0, activityMilli: row.activity ?? 0, balanceMilli: row.balance ?? 0, goalUnderFundedMilli: row.goal_under_funded ?? 0 })
              .onConflictDoUpdate({ target: [categoryMonths.categoryId, categoryMonths.month], set: { budgetedMilli: row.budgeted ?? 0, activityMilli: row.activity ?? 0, balanceMilli: row.balance ?? 0, goalUnderFundedMilli: row.goal_under_funded ?? 0 } }).run();
          }
          this.database.db.insert(settings).values({ key: `ready_to_assign:${month}`, value: delta.readyToAssignMilli ?? 0, updatedAt: at, updatedBy: 'sync' })
            .onConflictDoUpdate({ target: settings.key, set: { value: delta.readyToAssignMilli ?? 0, updatedAt: at, updatedBy: 'sync' } }).run();
          this.mark(`month:${month}`, delta.serverKnowledge, at);
        })();
      }

      const transactionDelta = await this.ynab.transactions(this.knowledge('transactions'), sinceDate);
      this.database.sqlite.transaction(() => {
        this.storeTransactions(transactionDelta.items, at, changedTransactionIds);
        this.mark('transactions', transactionDelta.serverKnowledge, at);
      })();

      let local = this.localUnapprovedCount(sinceDate);
      const remote = await this.ynab.countUnapproved(sinceDate);
      if (local !== remote) {
        const snapshot = await this.ynab.transactions(0, sinceDate);
        const snapshotIds = new Set(snapshot.items.map((row) => row.id));
        this.database.sqlite.transaction(() => {
          this.storeTransactions(snapshot.items, at, changedTransactionIds, true);
          const missing = this.database.db.select({ id: transactions.id }).from(transactions).where(and(gte(transactions.date, sinceDate), eq(transactions.deleted, false))).all()
            .filter((row) => !snapshotIds.has(row.id));
          for (const row of missing) {
            changedTransactionIds.push(row.id);
            this.database.db.update(transactions).set({ deleted: true, syncedAt: at }).where(eq(transactions.id, row.id)).run();
          }
          this.mark('transactions', snapshot.serverKnowledge, at);
        })();
        local = this.localUnapprovedCount(sinceDate);
      }
      if (local !== remote) {
        const detail = `local ${local} vs YNAB ${remote} unapproved in ${sinceDate}..today`;
        this.database.db.insert(syncState).values({ resource: 'transactions', serverKnowledge: transactionDelta.serverKnowledge, lastSyncedAt: at, lastReconciledAt: at, status: 'failed', detail })
          .onConflictDoUpdate({ target: syncState.resource, set: { lastReconciledAt: at, status: 'failed', detail } }).run();
        await this.messenger.send(this.env.ADMIN_PHONE, `SYNC RECONCILE FAILED: ${detail}. Jobs paused.`).catch(() => undefined);
        await this.pingHealth(false, detail);
        return { ok: false, sinceDate, localUnapproved: local, remoteUnapproved: remote, changedTransactionIds: [...new Set(changedTransactionIds)] };
      }
      this.database.db.update(syncState).set({ status: 'ok', lastReconciledAt: at, detail: null }).where(eq(syncState.resource, 'transactions')).run();
      await this.pingHealth(true);
      return { ok: true, sinceDate, localUnapproved: local, remoteUnapproved: remote, changedTransactionIds: [...new Set(changedTransactionIds)] };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.database.db.insert(syncState).values({ resource: 'transactions', serverKnowledge: this.knowledge('transactions'), lastSyncedAt: at, status: 'failed', detail })
        .onConflictDoUpdate({ target: syncState.resource, set: { status: 'failed', detail } }).run();
      await this.pingHealth(false, detail);
      throw error;
    }
  }

  private async pingHealth(ok: boolean, detail = '') {
    if (!this.env.HC_UUID || this.env.MOCK_EXTERNALS) return;
    await fetch(`https://hc-ping.com/${this.env.HC_UUID}${ok ? '' : '/fail'}`, { method: 'POST', body: detail }).catch(() => undefined);
  }
}

export function syncHealthy(database: AppDatabase): boolean {
  return database.db.select().from(syncState).where(eq(syncState.resource, 'transactions')).get()?.status === 'ok';
}
