import { and, eq, gt } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { categories, categoryMonths, proposals as proposalRows, settings } from '../db/schema.js';
import { WriteGateway } from '../proposals/writeGateway.js';
import { ProposalService } from '../proposals/service.js';
import type { AppEnv } from '../config/env.js';
import { monthKeyInTimeZone, shiftMonth } from '../time.js';

export function parseBillCategory(name: string): { day: number; amountMilli: number } | null {
  const day = /\bon\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(name);
  const amount = /\$([\d,]+(?:\.\d{1,2})?)/.exec(name);
  if (!day || !amount) return null;
  const parsedDay = Number(day[1]);
  if (parsedDay < 1 || parsedDay > 31) return null;
  return { day: parsedDay, amountMilli: Math.round(Number(amount[1].replaceAll(',', '')) * 1000) };
}

export function billIsWithin(day: number, windowDays: number, now = new Date()): boolean {
  const due = new Date(now.getFullYear(), now.getMonth(), day);
  if (due < new Date(now.getFullYear(), now.getMonth(), now.getDate())) due.setMonth(due.getMonth() + 1);
  const diff = Math.ceil((due.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  return diff >= 0 && diff <= windowDays;
}
export class FundingService {
  constructor(private readonly database: AppDatabase, private readonly writes: WriteGateway, private readonly proposals: ProposalService, private readonly env: AppEnv) {}

  essentials(): string[] {
    const stored = (this.database.db.select().from(settings).where(eq(settings.key, 'essentials_category_names')).get()?.value as string[] | undefined) ?? [];
    const active = new Set(this.database.db.select({ name: categories.name }).from(categories).where(and(eq(categories.hidden, false), eq(categories.deleted, false))).all().map((row) => row.name));
    return stored.filter((name) => active.has(name));
  }
  setEssentials(names: string[], actor: string) {
    const active = new Set(this.database.db.select({ name: categories.name }).from(categories).where(and(eq(categories.hidden, false), eq(categories.deleted, false))).all().map((row) => row.name));
    const clean = [...new Set(names.map((name) => name.trim()).filter((name) => Boolean(name) && active.has(name)))];
    this.database.db.insert(settings).values({ key: 'essentials_category_names', value: clean, updatedAt: new Date().toISOString(), updatedBy: actor })
      .onConflictDoUpdate({ target: settings.key, set: { value: clean, updatedAt: new Date().toISOString(), updatedBy: actor } }).run();
    return clean;
  }
  async run(readyToAssignMilli?: number) {
    const month = monthKeyInTimeZone(this.env.TIMEZONE);
    const syncedReady = this.database.db.select().from(settings).where(eq(settings.key, `ready_to_assign:${month}`)).get()?.value;
    const ready = readyToAssignMilli ?? (typeof syncedReady === 'number' ? syncedReady : 0);
    const essentialNames = this.essentials().map((name) => name.toLowerCase());
    const underfunded = this.database.db.select({ category: categories, month: categoryMonths }).from(categoryMonths)
      .innerJoin(categories, eq(categories.id, categoryMonths.categoryId))
      .where(and(eq(categoryMonths.month, month), gt(categoryMonths.goalUnderFundedMilli, 0), eq(categories.hidden, false), eq(categories.deleted, false))).all();
    const autoFunded: Array<{ category: string; amountMilli: number }> = [];
    const proposed: Array<{ categoryId: string; category: string; amountMilli: number }> = [];
    const starved: Array<{ category: string; amountMilli: number }> = [];
    let remaining = ready;
    const essentials = underfunded.filter((row) => essentialNames.includes(row.category.name.toLowerCase()));
    const rest = underfunded.filter((row) => !essentialNames.includes(row.category.name.toLowerCase())).sort((a, b) => Number(Boolean(b.category.goalTargetDate)) - Number(Boolean(a.category.goalTargetDate)));
    for (const row of essentials) {
      const amount = Math.min(row.month.goalUnderFundedMilli, remaining);
      if (amount > 0) {
        await this.writes.mutate('system-auto', `/months/${month}/categories/${row.category.id}`, { budgeted: row.month.budgetedMilli + amount }, { budgeted: row.month.budgetedMilli });
        autoFunded.push({ category: row.category.name, amountMilli: amount });
      }
      remaining -= amount;
      if (amount < row.month.goalUnderFundedMilli) starved.push({ category: row.category.name, amountMilli: row.month.goalUnderFundedMilli - amount });
    }
    const holdback = Math.min(remaining, underfunded.reduce((sum, row) => {
      const bill = essentialNames.includes(row.category.name.toLowerCase()) ? parseBillCategory(row.category.name) : null;
      return sum + (bill && billIsWithin(bill.day, 14) ? Math.max(0, bill.amountMilli - row.month.balanceMilli - row.month.goalUnderFundedMilli) : 0);
    }, 0));
    let available = Math.max(0, remaining - holdback);
    for (const row of rest) {
      const amount = Math.min(row.month.goalUnderFundedMilli, available);
      if (amount > 0) proposed.push({ categoryId: row.category.id, category: row.category.name, amountMilli: amount });
      available -= amount; remaining -= amount;
      if (amount < row.month.goalUnderFundedMilli) starved.push({ category: row.category.name, amountMilli: row.month.goalUnderFundedMilli - amount });
    }
    let proposalId: string | null = null;
    if (proposed.length) {
      const lines = proposed.slice(0, 5).map((item) => `${item.category} $${(item.amountMilli / 1000).toFixed(2)}`);
      const writes = proposed.map((item) => {
        const prior = underfunded.find((row) => row.category.id === item.categoryId)!.month.budgetedMilli;
        return { endpoint: `/months/${month}/categories/${item.categoryId}`, request: { budgeted: prior + item.amountMilli }, reversalHint: { budgeted: prior } };
      });
      const releaseRows = starved.filter((item) => holdback > 0).map((item) => {
        const row = underfunded.find((candidate) => candidate.category.name === item.category)!;
        return { endpoint: `/months/${month}/categories/${row.category.id}`, request: { budgeted: row.month.budgetedMilli + row.month.goalUnderFundedMilli }, reversalHint: { budgeted: row.month.budgetedMilli } };
      });
      proposalId = await this.proposals.create('funding', { writes, releaseWrites: [...writes, ...releaseRows] },
        `FUND: RTA $${(ready / 1000).toFixed(0)}. Auto-funded $${(autoFunded.reduce((sum, item) => sum + item.amountMilli, 0) / 1000).toFixed(0)}. Propose: ${lines.join(', ')}${proposed.length > 5 ? ` (+${proposed.length - 5} more)` : ''}. Starved: ${starved.length ? starved.map((item) => item.category).join(', ') : 'none'}. Holdback: $${(holdback / 1000).toFixed(0)}.`);
    }
    return { autoFunded, proposed, starved, holdbackMilli: holdback, proposalId, remainingMilli: remaining };
  }

  status() {
    const month = monthKeyInTimeZone(this.env.TIMEZONE);
    const readySetting = this.database.db.select().from(settings).where(eq(settings.key, `ready_to_assign:${month}`)).get();
    const underfunded = this.database.db.select({ amount: categoryMonths.goalUnderFundedMilli }).from(categoryMonths).innerJoin(categories, eq(categories.id, categoryMonths.categoryId))
      .where(and(eq(categoryMonths.month, month), gt(categoryMonths.goalUnderFundedMilli, 0), eq(categories.hidden, false), eq(categories.deleted, false))).all();
    const history = this.database.db.select().from(proposalRows).where(eq(proposalRows.kind, 'funding')).all();
    return {
      month,
      readyToAssignMilli: typeof readySetting?.value === 'number' ? readySetting.value : 0,
      lastSyncedAt: readySetting?.updatedAt ?? null,
      selectedEssentials: this.essentials(),
      underfundedMilli: underfunded.reduce((sum, row) => sum + row.amount, 0),
      underfundedCount: underfunded.length,
      nextMonthlyPass: shiftMonth(month, 1),
      recentProposals: history.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    };
  }
}
