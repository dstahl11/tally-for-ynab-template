import { and, eq, lte, sql } from 'drizzle-orm';
import type { AppEnv } from '../config/env.js';
import type { AppDatabase } from '../db/client.js';
import { alertEvents, categories, categoryMonths, messagesLog, queueItems, settings, transactions, users } from '../db/schema.js';
import { visibleScope } from '../auth/scope.js';
import { daysLeftInMonth, monthKeyInTimeZone } from '../time.js';
import type { Messenger } from '../services/messages.js';
import { normalizePayee } from '../rules/normalize.js';

interface ThresholdSettings {
  spendPercentages: number[];
  unknownMonthlyReviewMilli: number | null;
  chatRequestsPerUserPerDay: number;
  reimbursementFloatCategories: string[];
  holdbackEnabled: boolean;
}

export class MemberAutomation {
  constructor(private readonly database: AppDatabase, private readonly messenger: Messenger, private readonly env: AppEnv) {}

  private config(): ThresholdSettings {
    return this.database.db.select().from(settings).where(eq(settings.key, 'thresholds')).get()!.value as ThresholdSettings;
  }
  private member() { return this.database.db.select().from(users).where(eq(users.role, 'member')).get(); }
  private async send(to: string, body: string) {
    const result = await this.messenger.send(to, body);
    this.database.db.insert(messagesLog).values({ direction: 'outbound', toPhone: to, fromPhone: this.env.TWILIO_FROM ?? 'mock', body, twilioSid: result.sid, at: new Date().toISOString() }).run();
  }

  async evaluateAlerts(now = new Date()) {
    const member = this.member(); if (!member) return [];
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: this.env.TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (hour >= 21 || hour < 8) return [];
    const scope = visibleScope(member); const month = monthKeyInTimeZone(this.env.TIMEZONE, now); const config = this.config();
    const excluded = new Set(config.reimbursementFloatCategories.map((name) => name.toLowerCase()));
    const rows = this.database.db.select({ id: categories.id, name: categories.name, budgeted: categoryMonths.budgetedMilli, activity: categoryMonths.activityMilli, balance: categoryMonths.balanceMilli })
      .from(categoryMonths).innerJoin(categories, eq(categories.id, categoryMonths.categoryId))
      .where(and(eq(categoryMonths.month, month), scope.categoryPredicate, eq(categories.deleted, false))).all();
    const sent: string[] = [];
    for (const row of rows) {
      if (row.budgeted <= 0 || excluded.has(row.name.toLowerCase())) continue;
      const percent = Math.abs(row.activity) / row.budgeted * 100;
      for (const threshold of config.spendPercentages.filter((value) => percent >= value).sort((a, b) => b - a).slice(0, 1)) {
        const exists = this.database.db.select().from(alertEvents).where(and(eq(alertEvents.categoryId, row.id), eq(alertEvents.month, month), eq(alertEvents.threshold, threshold))).get();
        if (exists) continue;
        const body = `${row.name}: ${Math.round(percent)}% used, $${(row.balance / 1000).toFixed(0)} left.`;
        await this.send(member.phone, body);
        this.database.db.insert(alertEvents).values({ categoryId: row.id, month, threshold, sentAt: now.toISOString() }).run(); sent.push(body);
      }
    }
    return sent;
  }

  async sendDigest(now = new Date()) {
    const member = this.member(); if (!member) return null;
    const scope = visibleScope(member); const month = monthKeyInTimeZone(this.env.TIMEZONE, now); const days = daysLeftInMonth(this.env.TIMEZONE, now);
    const config = this.config(); const excluded = new Set(config.reimbursementFloatCategories.map((name) => name.toLowerCase()));
    const rows = this.database.db.select({ name: categories.name, budgeted: categoryMonths.budgetedMilli, activity: categoryMonths.activityMilli, balance: categoryMonths.balanceMilli })
      .from(categoryMonths).innerJoin(categories, eq(categories.id, categoryMonths.categoryId)).where(and(eq(categoryMonths.month, month), scope.categoryPredicate, eq(categories.deleted, false))).all()
      .filter((row) => !excluded.has(row.name.toLowerCase()));
    const queueCount = this.database.db.select({ count: sql<number>`count(*)` }).from(queueItems).innerJoin(transactions, eq(transactions.id, queueItems.transactionId))
      .where(and(scope.transactionPredicate, sql`${queueItems.state} in ('pending','retry')`)).get()!.count;
    const lines = rows.slice(0, 8).map((row) => `${row.name}: $${(row.balance / 1000).toFixed(0)} left, ${days}d, ${row.budgeted > 0 && Math.abs(row.activity) / row.budgeted > .75 ? 'watch' : 'on pace'}`);
    if (queueCount) lines.push(`${queueCount} charge${queueCount === 1 ? '' : 's'} need a tap: ${this.env.APP_HOST}/queue`);
    const body = lines.join('\n'); await this.send(member.phone, body); return body;
  }

  advanceMysteryRetries(now = new Date()) {
    const due = this.database.db.select().from(queueItems).where(and(eq(queueItems.state, 'unknown'), lte(queueItems.retryAt, now.toISOString()))).all();
    for (const item of due) this.database.db.update(queueItems).set({ state: 'retry', retryCount: item.retryCount + 1, askedAt: now.toISOString() }).where(eq(queueItems.transactionId, item.transactionId)).run();
    return due.length;
  }

  async handlePrecommit(fromPhone: string, body: string) {
    const member = this.database.db.select().from(users).where(eq(users.phone, fromPhone)).get(); if (!member) return null;
    const match = /\$?([\d,]+(?:\.\d{1,2})?)\s+(?:at|for)\s+(.+)/i.exec(body.replace(/^\?\s*/, ''));
    if (!match) return null;
    const amountMilli = Math.round(Number(match[1].replaceAll(',', '')) * 1000); const merchant = normalizePayee(match[2]); const scope = visibleScope(member);
    const history = this.database.db.select({ categoryId: transactions.categoryId, categoryName: transactions.categoryName, count: sql<number>`count(*)` }).from(transactions)
      .where(and(scope.transactionPredicate, eq(transactions.payeeNorm, merchant), sql`${transactions.categoryId} is not null`)).groupBy(transactions.categoryId, transactions.categoryName).orderBy(sql`count(*) desc`).get();
    if (!history?.categoryId) { const response = `${match[2]}: no reliable category history.`; await this.send(fromPhone, response); return response; }
    const month = monthKeyInTimeZone(this.env.TIMEZONE); const current = this.database.db.select().from(categoryMonths).where(and(eq(categoryMonths.categoryId, history.categoryId), eq(categoryMonths.month, month))).get();
    const before = current?.balanceMilli ?? 0; const after = before - amountMilli; const response = `${history.categoryName}: $${(before / 1000).toFixed(0)} now, $${(after / 1000).toFixed(0)} after.`;
    await this.send(fromPhone, response); return response;
  }
}
