import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
};

export const syncState = sqliteTable('sync_state', {
  resource: text('resource').primaryKey(),
  serverKnowledge: integer('server_knowledge').notNull().default(0),
  lastSyncedAt: text('last_synced_at'),
  lastReconciledAt: text('last_reconciled_at'),
  status: text('status', { enum: ['ok', 'failed'] }).notNull().default('ok'),
  detail: text('detail'),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  onBudget: integer('on_budget', { mode: 'boolean' }).notNull(),
  closed: integer('closed', { mode: 'boolean' }).notNull().default(false),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  raw: text('raw', { mode: 'json' }).notNull(),
  syncedAt: text('synced_at').notNull(),
});

export const payees = sqliteTable('payees', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  raw: text('raw', { mode: 'json' }).notNull(),
  syncedAt: text('synced_at').notNull(),
});

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull(),
  groupName: text('group_name').notNull(),
  name: text('name').notNull(),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  note: text('note'),
  goalType: text('goal_type'),
  goalTargetMilli: integer('goal_target_milli'),
  goalTargetDate: text('goal_target_date'),
  raw: text('raw', { mode: 'json' }).notNull(),
  syncedAt: text('synced_at').notNull(),
}, (table) => [index('idx_categories_group_name').on(table.groupName), uniqueIndex('idx_categories_name_active').on(table.name, table.deleted)]);

export const categoryMonths = sqliteTable('category_months', {
  categoryId: text('category_id').notNull().references(() => categories.id),
  month: text('month').notNull(),
  budgetedMilli: integer('budgeted_milli').notNull().default(0),
  activityMilli: integer('activity_milli').notNull().default(0),
  balanceMilli: integer('balance_milli').notNull().default(0),
  goalUnderFundedMilli: integer('goal_under_funded_milli').notNull().default(0),
}, (table) => [primaryKey({ columns: [table.categoryId, table.month] }), index('idx_category_months_month').on(table.month)]);

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  amountMilli: integer('amount_milli').notNull(),
  payeeId: text('payee_id'),
  payeeName: text('payee_name'),
  payeeNorm: text('payee_norm'),
  importPayeeName: text('import_payee_name'),
  importPayeeNameOriginal: text('import_payee_name_original'),
  categoryId: text('category_id'),
  categoryName: text('category_name'),
  accountId: text('account_id').notNull(),
  accountName: text('account_name').notNull(),
  memo: text('memo'),
  approved: integer('approved', { mode: 'boolean' }).notNull(),
  cleared: text('cleared').notNull(),
  transferAccountId: text('transfer_account_id'),
  transferTransactionId: text('transfer_transaction_id'),
  matchedTransactionId: text('matched_transaction_id'),
  isSplit: integer('is_split', { mode: 'boolean' }).notNull().default(false),
  deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false),
  raw: text('raw', { mode: 'json' }).notNull(),
  syncedAt: text('synced_at').notNull(),
}, (table) => [
  index('idx_transactions_date').on(table.date),
  index('idx_transactions_category_date').on(table.categoryId, table.date),
  index('idx_transactions_original_payee').on(table.importPayeeNameOriginal),
  index('idx_transactions_payee_norm').on(table.payeeNorm),
  index('idx_transactions_approved_deleted').on(table.approved, table.deleted),
  index('idx_transactions_account_date').on(table.accountId, table.date),
]);

export const rules = sqliteTable('rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', { enum: ['payee_route', 'payee_category', 'item_category'] }).notNull(),
  matchField: text('match_field', { enum: ['import_payee_name_original', 'payee_norm', 'item_name'] }).notNull(),
  matchType: text('match_type', { enum: ['contains', 'prefix', 'regex'] }).notNull(),
  pattern: text('pattern').notNull(),
  secondaryPattern: text('secondary_pattern'),
  action: text('action', { mode: 'json' }).$type<{ categoryId?: string; categoryName?: string; route?: string }>().notNull(),
  priority: integer('priority').notNull().default(100),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdBy: text('created_by', { enum: ['seed', 'override', 'admin'] }).notNull(),
  hitCount: integer('hit_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_rules_active_priority').on(table.enabled, table.priority)]);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').notNull().unique(),
  role: text('role', { enum: ['admin', 'member'] }).notNull(),
  accountId: text('account_id'),
  visibleGroupId: text('visible_group_id'),
  visibleCategoryIds: text('visible_category_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
  ...timestamps,
});

export const magicLinks = sqliteTable('magic_links', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_magic_links_user_created').on(table.userId, table.createdAt)]);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
}, (table) => [index('idx_sessions_user').on(table.userId)]);

export const proposals = sqliteTable('proposals', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['funding', 'target_change', 'category_split', 'new_category', 'recategorize'] }).notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  summarySms: text('summary_sms').notNull(),
  status: text('status', { enum: ['open', 'approved', 'rejected', 'expired', 'executed', 'failed'] }).notNull(),
  recipientUserId: text('recipient_user_id').notNull().references(() => users.id),
  createdAt: text('created_at').notNull(),
  resolvedAt: text('resolved_at'),
  executedAt: text('executed_at'),
  executionResult: text('execution_result', { mode: 'json' }),
});

export const writeLog = sqliteTable('write_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: text('at').notNull(),
  actor: text('actor').notNull(),
  endpoint: text('endpoint').notNull(),
  request: text('request', { mode: 'json' }).notNull(),
  responseStatus: integer('response_status'),
  response: text('response', { mode: 'json' }),
  reversalHint: text('reversal_hint', { mode: 'json' }).notNull(),
  dryRun: integer('dry_run', { mode: 'boolean' }).notNull(),
}, (table) => [index('idx_write_log_at').on(table.at)]);

export const messagesLog = sqliteTable('messages_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
  toPhone: text('to_phone').notNull(),
  fromPhone: text('from_phone').notNull(),
  body: text('body').notNull(),
  twilioSid: text('twilio_sid'),
  relatedProposalId: text('related_proposal_id'),
  at: text('at').notNull(),
});

export const queueItems = sqliteTable('queue_items', {
  transactionId: text('transaction_id').primaryKey().references(() => transactions.id),
  state: text('state', { enum: ['pending', 'answered', 'unknown', 'retry', 'rested'] }).notNull(),
  suggestions: text('suggestions', { mode: 'json' }).$type<Array<{ categoryId: string | null; label: string; source: string }>>().notNull(),
  enrichment: text('enrichment', { mode: 'json' }),
  askedAt: text('asked_at'),
  retryAt: text('retry_at'),
  answeredAt: text('answered_at'),
  answerCategoryId: text('answer_category_id'),
  retryCount: integer('retry_count').notNull().default(0),
}, (table) => [index('idx_queue_items_state_retry').on(table.state, table.retryAt)]);

export const overrides = sqliteTable('overrides', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  transactionId: text('transaction_id').notNull().references(() => transactions.id),
  fromCategoryId: text('from_category_id'),
  toCategoryId: text('to_category_id').notNull(),
  source: text('source', { enum: ['queue', 'ynab-detected', 'chat'] }).notNull(),
  at: text('at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
});

export const alertEvents = sqliteTable('alert_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  categoryId: text('category_id').notNull(),
  month: text('month').notNull(),
  threshold: integer('threshold').notNull(),
  sentAt: text('sent_at').notNull(),
}, (table) => [uniqueIndex('idx_alert_events_once').on(table.categoryId, table.month, table.threshold)]);

export const chatUsage = sqliteTable('chat_usage', {
  userId: text('user_id').notNull().references(() => users.id),
  day: text('day').notNull(),
  requestCount: integer('request_count').notNull().default(0),
}, (table) => [primaryKey({ columns: [table.userId, table.day] })]);
