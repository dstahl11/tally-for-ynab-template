import Anthropic from '@anthropic-ai/sdk';
import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../config/env.js';
import type { AppDatabase } from '../db/client.js';
import { categories, categoryMonths, chatUsage, transactions } from '../db/schema.js';
import { visibleScope, type AppUser } from '../auth/scope.js';
import { parseModelJson, plainTextAnswer } from '../ai/modelJson.js';
import { dateKeyInTimeZone, daysLeftInMonth, monthKeyInTimeZone, shiftMonth } from '../time.js';

const chartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bar_vs_budget'), title: z.string().optional(), series: z.array(z.object({ label: z.string(), spent: z.number() })), budget: z.number() }),
  z.object({ type: z.literal('trend_line'), title: z.string().optional(), series: z.array(z.object({ label: z.string(), value: z.number() })), budget: z.number().optional() }),
  z.object({ type: z.literal('monthly_category_bars'), title: z.string().optional(), months: z.array(z.object({ label: z.string(), total: z.number(), segments: z.array(z.object({ label: z.string(), value: z.number() })).max(8) })).max(12) }),
  z.object({ type: z.literal('category_donut'), title: z.string().optional(), slices: z.array(z.object({ label: z.string(), value: z.number(), query: z.string().optional() })).max(7) }),
  z.object({ type: z.literal('txn_list'), title: z.string().optional(), rows: z.array(z.object({ date: z.string(), payee: z.string(), amount: z.number(), memo: z.string().optional() })).max(15) }),
  z.object({ type: z.literal('stat_card'), title: z.string().optional(), value: z.string(), delta: z.string().optional(), verdict: z.enum(['ok', 'over', 'warn']) }),
]);
export type ChartSpec = z.infer<typeof chartSchema>;
const answerSchema = z.object({ answer_md: z.string(), chart: z.unknown().nullable().optional(), followups: z.array(z.string()).optional() });
type ToolObservation = { name: string; result: any };

export type BudgetCategoryCandidate = { id: string; name: string; groupName: string };
export type BudgetConcept = { label: string; categories: BudgetCategoryCandidate[]; matchedBy: 'category' | 'group' | 'concept' };
type SpendingGrouping = 'category' | 'month' | 'payee' | 'transactions';

const conceptDefinitions: Array<{ label: string; query: RegExp; category: RegExp; group?: RegExp }> = [
  {
    label: 'Adventure Travel & Gear',
    query: /\b(adventure|ski(?:ing)?|skis?|snowboard(?:ing)?|bike|bikes|biking|bicycle|cycling|hike|hiking|camp(?:ing)?|climb(?:ing)?|kayak(?:ing)?|paddle(?:boarding)?|outdoor(?:s| sports?| gear)?|sporting goods)\b/i,
    category: /\b(adventure|outdoor|travel.*gear|gear.*travel)\b/i,
    group: /\b(adventure|outdoor)\b/i,
  },
  {
    label: 'Entertainment',
    query: /\b(entertainment|just for fun|movies?|cinema|netflix|crunchyroll|streaming|concerts?|television|tv)\b/i,
    category: /\b(entertainment|movies?|cinema|netflix|crunchyroll|streaming|concerts?|television|tv)\b/i,
    group: /\bjust for fun\b/i,
  },
  {
    label: 'Food',
    query: /\b(food|grocer(?:y|ies)|eating out|dining|restaurants?|takeout|take out|delivery|meals?)\b/i,
    category: /\b(food|grocer(?:y|ies)|eating out|dining|restaurants?|takeout|take out|meals?)\b/i,
    group: /\b(food|dining)\b/i,
  },
];

function normalized(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim().toLowerCase();
}

const merchantEntities: Record<string, string> = { '&amp;': '&', '&#39;': "'", '&quot;': '"' };
export function cleanMerchantName(value: string): string {
  return value.replace(/&(?:amp|#39|quot);/g, (entity) => merchantEntities[entity] ?? entity).trim();
}

export function inferBudgetConcept(query: string, candidates: BudgetCategoryCandidate[]): BudgetConcept | null {
  const normalizedQuery = normalized(query);
  const exactCategories = candidates.filter((candidate) => {
    const name = normalized(candidate.name);
    return name.length >= 3 && new RegExp(`(?:^| )${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`).test(normalizedQuery);
  });
  if (exactCategories.length) return { label: exactCategories.length === 1 ? exactCategories[0].name : 'Selected categories', categories: exactCategories, matchedBy: 'category' };

  const exactGroups = candidates.filter((candidate) => {
    const group = normalized(candidate.groupName);
    return group.length >= 3 && new RegExp(`(?:^| )${group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`).test(normalizedQuery);
  });
  if (exactGroups.length) return { label: exactGroups[0].groupName, categories: exactGroups, matchedBy: 'group' };

  for (const definition of conceptDefinitions) {
    if (!definition.query.test(normalizedQuery)) continue;
    const matches = candidates.filter((candidate) => definition.category.test(normalized(candidate.name)) || Boolean(definition.group?.test(normalized(candidate.groupName))));
    if (matches.length) return { label: definition.label, categories: matches, matchedBy: 'concept' };
  }
  return null;
}

const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const monthNumbers: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

export function requestedMonthRange(query: string, currentMonth: string): { fromMonth: string; toMonth: string } {
  const lower = query.toLowerCase();
  const explicitRange = lower.match(/\b(20\d{2})-(0[1-9]|1[0-2])(?:-01)?\s+(?:through|to)\s+(20\d{2})-(0[1-9]|1[0-2])(?:-01)?\b/);
  if (explicitRange) return { fromMonth: `${explicitRange[1]}-${explicitRange[2]}-01`, toMonth: `${explicitRange[3]}-${explicitRange[4]}-01` };
  const explicitKey = lower.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (explicitKey) {
    const month = `${explicitKey[1]}-${explicitKey[2]}-01`;
    return { fromMonth: month, toMonth: month };
  }
  const namedMonth = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/);
  if (namedMonth) {
    const month = `${namedMonth[2]}-${String(monthNumbers[namedMonth[1]]).padStart(2, '0')}-01`;
    return { fromMonth: month, toMonth: month };
  }
  if (/\b(last|previous) month\b/.test(lower)) {
    const month = shiftMonth(currentMonth, -1);
    return { fromMonth: month, toMonth: month };
  }
  const rolling = lower.match(/\b(?:last|past|previous|over the last|over the previous)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+months?\b/);
  if (rolling) {
    const count = Math.min(24, Number(rolling[1]) || numberWords[rolling[1]] || 1);
    if (/\bincluding this month\b/.test(lower)) return { fromMonth: shiftMonth(currentMonth, -(count - 1)), toMonth: currentMonth };
    return { fromMonth: shiftMonth(currentMonth, -count), toMonth: shiftMonth(currentMonth, -1) };
  }
  return { fromMonth: currentMonth, toMonth: currentMonth };
}

function spendingGrouping(query: string, range: { fromMonth: string; toMonth: string }): SpendingGrouping {
  if (/\b(transactions?|purchases?|charges?|receipts?|what did i buy|show me the items?)\b/i.test(query)) return 'transactions';
  if (/\b(by merchant|by payee|by store|which stores?|which merchants?|where did (?:i|we))\b/i.test(query)) return 'payee';
  if (range.fromMonth !== range.toMonth || /\b(trend|over time|month by month|compare months?)\b/i.test(query)) return 'month';
  return 'category';
}

function monthQueryLabel(month: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month.slice(0, 7)}-01T12:00:00Z`));
}

function transactionQueryFor(result: any, label: string): string | undefined {
  if (!label || label === 'Other') return undefined;
  if (result.period_label === 'the past 30 days') return `Show ${label} transactions from the past 30 days`;
  if (result.from_month && result.to_month && result.from_month !== result.to_month) return `Show ${label} transactions from ${result.from_month.slice(0, 7)} through ${result.to_month.slice(0, 7)}`;
  const month = result.from_month ?? result.month;
  return month ? `Show ${label} transactions in ${monthQueryLabel(month)}` : undefined;
}

function chartForSpendingBreakdown(result: any): ChartSpec | null {
  if (!result || result.error) return null;
  const label = typeof result.label === 'string' ? result.label.trim() : '';
  const title = label ? `${label} ${result.grouping === 'month' ? 'over time' : result.grouping === 'transactions' ? 'transactions' : 'spending'}` : undefined;
  if (result.grouping === 'transactions' && Array.isArray(result.transactions) && result.transactions.length) {
    return { type: 'txn_list', title, rows: result.transactions.slice(0, 15).map((row: any) => ({ date: row.date, payee: row.payee ?? 'Unknown merchant', amount: row.amount, ...(row.memo ? { memo: row.memo } : {}) })) };
  }
  if (result.comparison && Array.isArray(result.category_budget_breakdown) && result.category_budget_breakdown.length) {
    return { type: 'bar_vs_budget', title: label ? `${label} vs budget` : title, series: result.category_budget_breakdown.map((row: any) => ({ label: row.label, spent: row.spent })), budget: result.total_budgeted ?? 0 };
  }
  if (result.grouping === 'month' && Array.isArray(result.monthly_breakdown) && result.monthly_breakdown.length) {
    if (result.monthly_breakdown.length <= 6 && Array.isArray(result.monthly_category_breakdown)) {
      return { type: 'monthly_category_bars', title: label ? `${label} by month` : title, months: result.monthly_category_breakdown };
    }
    return { type: 'trend_line', title, series: result.monthly_breakdown.map((row: any) => ({ label: row.label.slice(0, 7), value: row.value })) };
  }
  if (result.grouping === 'payee' && Array.isArray(result.payee_breakdown) && result.payee_breakdown.length) {
    return { type: 'bar_vs_budget', title: label ? `${label} by merchant` : title, series: result.payee_breakdown.slice(0, 7).map((row: any) => ({ label: row.label, spent: row.value })), budget: 0 };
  }
  if (Array.isArray(result.category_breakdown) && result.category_breakdown.length > 1) {
    const ranked = [...result.category_breakdown].filter((row: any) => row.value > 0).sort((left: any, right: any) => right.value - left.value);
    const slices = ranked.length > 7 ? [...ranked.slice(0, 6), { label: 'Other', value: ranked.slice(6).reduce((sum: number, row: any) => sum + row.value, 0) }] : ranked;
    if (slices.length) return { type: 'category_donut', title, slices: slices.map((slice: any) => ({ ...slice, ...(transactionQueryFor(result, slice.label) ? { query: transactionQueryFor(result, slice.label) } : {}) })) };
  }
  if (Array.isArray(result.category_breakdown) && result.category_breakdown.length) {
    return { type: 'bar_vs_budget', title, series: result.category_breakdown.map((row: any) => ({ label: row.label, spent: row.value })), budget: result.total_budgeted ?? 0 };
  }
  return { type: 'stat_card', title, value: '$0.00', delta: 'No spending in this period', verdict: 'ok' };
}

export function chartForToolResults(observations: ToolObservation[]): ChartSpec | null {
  for (const observation of [...observations].reverse()) {
    if (observation.name === 'get_spending_breakdown') {
      const focused = chartForSpendingBreakdown(observation.result);
      if (focused) return focused;
    }
  }
  for (const observation of [...observations].reverse()) {
    const result = observation.result;
    if ((observation.name === 'get_pace' || observation.name === 'simulate_purchase') && result && !result.error) {
      const value = observation.name === 'simulate_purchase' ? result.after : result.remaining;
      return { type: 'stat_card', value: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value), delta: `${result.days_left} days left · ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(result.daily_rate)}/day`, verdict: result.verdict === 'over' ? 'over' : value === 0 ? 'warn' : 'ok' };
    }
    if (observation.name === 'get_month_summary' && Array.isArray(result?.categories)) {
      const ranked = result.categories.filter((row: any) => row.activity < 0).sort((left: any, right: any) => left.activity - right.activity).map((row: any) => ({ label: row.category, value: Math.abs(row.activity) }));
      const slices = ranked.length > 7 ? [...ranked.slice(0, 6), { label: 'Other', value: ranked.slice(6).reduce((sum: number, row: any) => sum + row.value, 0) }] : ranked;
      if (slices.length) return { type: 'category_donut', slices: slices.map((slice: any) => ({ ...slice, ...(transactionQueryFor(result, slice.label) ? { query: transactionQueryFor(result, slice.label) } : {}) })) };
    }
    if (observation.name === 'get_category_spending' && Array.isArray(result) && result.length) {
      const byMonth = new Map<string, number>();
      for (const row of result) byMonth.set(row.month, (byMonth.get(row.month) ?? 0) + Math.abs(Math.min(0, row.activity)));
      const series = [...byMonth].sort(([left], [right]) => left.localeCompare(right)).map(([label, value]) => ({ label: label.slice(0, 7), value }));
      if (series.length) return { type: 'trend_line', series };
    }
    if (observation.name === 'list_transactions' && Array.isArray(result) && result.length) {
      return { type: 'txn_list', rows: result.slice(0, 15).map((row: any) => ({ date: row.date, payee: row.payee ?? 'Unknown merchant', amount: row.amount, ...(row.memo ? { memo: row.memo } : {}) })) };
    }
  }
  return null;
}

export class ChatService {
  private readonly anthropic?: Anthropic;
  constructor(private readonly database: AppDatabase, private readonly env: AppEnv) {
    if (!env.MOCK_EXTERNALS && env.ANTHROPIC_API_KEY) this.anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  async ask(user: AppUser, message: string) {
    if (!this.consume(user)) return { answer_md: 'Daily chat limit reached. Try again after midnight.', chart: null, followups: [] };
    const summary = this.monthSummary(user);
    const focused = this.preResolvedSpending(user, message);
    if (focused) return this.focusedAnswer(focused);
    if (this.env.MOCK_EXTERNALS || !this.anthropic) return this.mockAnswer(message, summary);
    const messages: any[] = [{ role: 'user', content: message }];
    const observations: ToolObservation[] = [];
    const catalog = this.visibleCategories(user).map((category) => `${category.groupName} > ${category.name}`).join('\n');
    let text = '';
    for (let turn = 0; turn < 6; turn++) {
      const response = await this.anthropic.messages.create({
        model: this.env.ANTHROPIC_MODEL, max_tokens: 1024,
        system: `You are a blunt, read-only budget analyst. Today is ${this.today()} in ${this.env.TIMEZONE}; "this month" means ${this.currentMonth()}. Resolve relative dates yourself and never ask the user to provide a month when they already used words like today, this month, or last month. Use tools for every number. Lead with the numeric verdict and format dollar amounts with $ and commas. Never claim to move money. Return only strict JSON: {"answer_md":string,"chart":object|null,"followups":string[]}. answer_md must be plain text without Markdown markers or code fences. The answer and chart must use the same category scope, date range, and grouping. For focused category, group, or concept questions, use get_spending_breakdown and never substitute get_month_summary. Map skiing, bikes, cycling, hiking, camping, and other outdoor sports to Adventure Travel & Gear. Map entertainment to the relevant Just for Fun categories. Map broad food questions to the relevant grocery, eating-out, and food categories. When a concept is inferred, describe the result as spending in its resolved budget category; do not claim individual transactions were specifically tagged with the user's synonym. Choose transactions for transaction requests, merchant bars for where/by-merchant questions, a trend for multiple months, and a category breakdown for a single-period concept. When a tool returns two or more comparable values, chart must not be null. Charts may only repeat tool-result numbers.

Visible budget catalog (already permission-scoped):
${catalog}

For every focused answer, the category_names sent to get_spending_breakdown are authoritative for both the written result and the chart. Do not replace them with a whole-budget summary.`,
        tools: this.toolDefinitions() as any, messages,
      });
      const calls = response.content.filter((block: any) => block.type === 'tool_use') as any[];
      if (!calls.length) { text = (response.content.find((block: any) => block.type === 'text') as any)?.text ?? ''; break; }
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: calls.map((call) => {
        const result = this.executeTool(user, call.name, call.input);
        observations.push({ name: call.name, result });
        return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) };
      }) });
    }
    try {
      const parsed = parseModelJson(text, answerSchema);
      const chart = chartSchema.safeParse(parsed.chart);
      return { answer_md: plainTextAnswer(parsed.answer_md), chart: chartForToolResults(observations) ?? (chart.success ? chart.data : null), followups: (parsed.followups ?? []).slice(0, 3) };
    } catch { return { answer_md: plainTextAnswer(text) || 'I could not turn that into a reliable budget answer. Try asking again.', chart: chartForToolResults(observations), followups: [] }; }
  }

  private toolDefinitions() {
    return [
      { name: 'get_spending_breakdown', description: 'Resolve a focused category, group, or natural-language budget concept and return exactly scoped spending for an intelligent chart. Use exact category_names from the visible catalog when inference is needed.', input_schema: { type: 'object', properties: { subject: { type: 'string' }, category_names: { type: 'array', items: { type: 'string' }, maxItems: 50 }, from_month: { type: 'string' }, to_month: { type: 'string' }, group_by: { type: 'string', enum: ['category', 'month', 'payee', 'transactions'] } }, required: ['subject', 'from_month', 'to_month', 'group_by'], additionalProperties: false } },
      { name: 'get_category_spending', description: 'Monthly assigned, activity, and available for a category.', input_schema: { type: 'object', properties: { category: { type: 'string' }, from_month: { type: 'string' }, to_month: { type: 'string' } }, required: ['from_month', 'to_month'], additionalProperties: false } },
      { name: 'get_pace', description: 'Current remaining amount and daily pace for a category.', input_schema: { type: 'object', properties: { category: { type: 'string' } }, required: ['category'], additionalProperties: false } },
      { name: 'list_transactions', description: 'Transactions in the visible scope.', input_schema: { type: 'object', properties: { category: { type: 'string' }, payee: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'integer', maximum: 50 } }, required: ['from', 'to'], additionalProperties: false } },
      { name: 'simulate_purchase', description: 'Read-only impact of a proposed purchase.', input_schema: { type: 'object', properties: { category: { type: 'string' }, amount: { type: 'number' } }, required: ['category', 'amount'], additionalProperties: false } },
      { name: 'get_month_summary', description: 'Visible spending-category summary for one month, excluding inflows, transfers, and credit-card payments.', input_schema: { type: 'object', properties: { month: { type: 'string' } }, required: ['month'], additionalProperties: false } },
    ];
  }

  private executeTool(user: AppUser, name: string, raw: unknown): unknown {
    const scope = visibleScope(user);
    const categorySpending = z.object({ category: z.string().optional(), from_month: z.string(), to_month: z.string() }).strict();
    const pace = z.object({ category: z.string() }).strict();
    const list = z.object({ category: z.string().optional(), payee: z.string().optional(), from: z.string(), to: z.string(), limit: z.number().int().max(50).default(50) }).strict();
    const simulate = z.object({ category: z.string(), amount: z.number().positive() }).strict();
    const monthSummary = z.object({ month: z.string() }).strict();
    const spendingBreakdown = z.object({ subject: z.string(), category_names: z.array(z.string()).max(50).optional(), from_month: z.string(), to_month: z.string(), group_by: z.enum(['category', 'month', 'payee', 'transactions']) }).strict();
    if (name === 'get_spending_breakdown') {
      const input = spendingBreakdown.parse(raw);
      const candidates = this.visibleCategories(user);
      const requested = new Set((input.category_names ?? []).map(normalized));
      const exact = requested.size ? candidates.filter((category) => requested.has(normalized(category.name))) : [];
      const concept = exact.length ? { label: exact.length === 1 ? exact[0].name : input.subject, categories: exact, matchedBy: 'category' as const } : inferBudgetConcept(input.subject, candidates);
      if (!concept) return { error: 'category_not_found', subject: input.subject };
      return this.spendingBreakdown(user, concept, input.from_month, input.to_month, input.group_by);
    }
    if (name === 'get_category_spending') {
      const input = categorySpending.parse(raw);
      return this.database.db.select({ month: categoryMonths.month, category: categories.name, budgeted: sql<number>`${categoryMonths.budgetedMilli} / 1000.0`, activity: sql<number>`${categoryMonths.activityMilli} / 1000.0`, balance: sql<number>`${categoryMonths.balanceMilli} / 1000.0` })
        .from(categoryMonths).innerJoin(categories, eq(categories.id, categoryMonths.categoryId))
        .where(and(scope.categoryPredicate, gte(categoryMonths.month, input.from_month), lte(categoryMonths.month, input.to_month), input.category ? sql`lower(${categories.name}) like ${`%${input.category.toLowerCase()}%`}` : sql`1=1`)).all();
    }
    if (name === 'get_pace' || name === 'simulate_purchase') {
      const input = name === 'get_pace' ? pace.parse(raw) : simulate.parse(raw);
      const month = this.currentMonth();
      const row = this.database.db.select({ category: categories.name, balance: categoryMonths.balanceMilli }).from(categoryMonths).innerJoin(categories, eq(categories.id, categoryMonths.categoryId))
        .where(and(scope.categoryPredicate, eq(categoryMonths.month, month), sql`lower(${categories.name}) like ${`%${input.category.toLowerCase()}%`}`)).get();
      if (!row) return { error: 'category_not_found' };
      const daysLeft = daysLeftInMonth(this.env.TIMEZONE);
      const remaining = row.balance / 1000; const after = name === 'simulate_purchase' ? remaining - (input as z.infer<typeof simulate>).amount : remaining;
      return { category: row.category, remaining, after, days_left: daysLeft, daily_rate: daysLeft ? after / daysLeft : after, verdict: after < 0 ? 'over' : 'ok' };
    }
    if (name === 'list_transactions') {
      const input = list.parse(raw);
      return this.database.db.select({ date: transactions.date, payee: transactions.payeeName, category: transactions.categoryName, amount: sql<number>`${transactions.amountMilli} / 1000.0`, memo: transactions.memo }).from(transactions)
        .where(and(scope.transactionPredicate, gte(transactions.date, input.from), lte(transactions.date, input.to), eq(transactions.deleted, false), input.category ? sql`lower(${transactions.categoryName}) like ${`%${input.category.toLowerCase()}%`}` : sql`1=1`, input.payee ? sql`lower(${transactions.payeeName}) like ${`%${input.payee.toLowerCase()}%`}` : sql`1=1`)).limit(input.limit).all();
    }
    if (name === 'get_month_summary') {
      const input = monthSummary.parse(raw);
      const month = /^\d{4}-\d{2}$/.test(input.month) ? `${input.month}-01` : input.month;
      const rows = this.database.db.select({ category: categories.name, group: categories.groupName, budgeted: categoryMonths.budgetedMilli, activity: categoryMonths.activityMilli, balance: categoryMonths.balanceMilli }).from(categoryMonths).innerJoin(categories, eq(categories.id, categoryMonths.categoryId)).where(and(scope.categoryPredicate, eq(categoryMonths.month, month))).all();
      const spending = rows.filter((row) => row.activity < 0 && !/credit card payments|internal master category|inflow|ready to assign/i.test(`${row.group} ${row.category}`));
      return { month, categories: spending.map((row) => ({ ...row, budgeted: row.budgeted / 1000, activity: row.activity / 1000, balance: row.balance / 1000 })), total_spent: Math.abs(spending.reduce((sum, row) => sum + row.activity, 0)) / 1000 };
    }
    return { error: 'unknown_tool' };
  }
  private consume(user: AppUser): boolean {
    if (user.role === 'admin' || this.env.CHAT_DAILY_LIMIT === 0) return true;
    const day = this.today();
    const row = this.database.db.select().from(chatUsage).where(and(eq(chatUsage.userId, user.id), eq(chatUsage.day, day))).get();
    if ((row?.requestCount ?? 0) >= this.env.CHAT_DAILY_LIMIT) return false;
    this.database.db.insert(chatUsage).values({ userId: user.id, day, requestCount: 1 }).onConflictDoUpdate({ target: [chatUsage.userId, chatUsage.day], set: { requestCount: (row?.requestCount ?? 0) + 1 } }).run();
    return true;
  }
  private monthSummary(user: AppUser) {
    const scope = visibleScope(user);
    const month = this.currentMonth();
    return this.database.db.select({ name: categories.name, group: categories.groupName, budgeted: categoryMonths.budgetedMilli, activity: categoryMonths.activityMilli, balance: categoryMonths.balanceMilli })
      .from(categoryMonths).innerJoin(categories, eq(categories.id, categoryMonths.categoryId))
      .where(and(eq(categoryMonths.month, month), scope.categoryPredicate, eq(categories.deleted, false))).all()
      .filter((row) => row.activity < 0 && !/credit card payments|internal master category|inflow|ready to assign/i.test(`${row.group} ${row.name}`));
  }
  private today() { return dateKeyInTimeZone(this.env.TIMEZONE); }
  private currentMonth() { return monthKeyInTimeZone(this.env.TIMEZONE); }
  private visibleCategories(user: AppUser): BudgetCategoryCandidate[] {
    const scope = visibleScope(user);
    return this.database.db.select({ id: categories.id, name: categories.name, groupName: categories.groupName }).from(categories)
      .where(and(scope.categoryPredicate, eq(categories.deleted, false), eq(categories.hidden, false))).all()
      .map((category) => ({ ...category, name: category.name.trim(), groupName: category.groupName.trim() }));
  }
  private preResolvedSpending(user: AppUser, message: string) {
    if (!/\b(spend|spent|spending|transactions?|purchases?|charges?|cost|where did|how much did|how much was|show|compare|budget)\b/i.test(message)) return null;
    if (/\b(left|remaining|available|pace|afford|fit(?:s)? in|what if|after (?:buying|spending))\b/i.test(message)) return null;
    const visibleCategories = this.visibleCategories(user);
    const inferred = inferBudgetConcept(message, visibleCategories);
    const wholeBudget = !inferred && /\b(?:(?:my|our|total|overall|all)\s+(?:spend|spending)|spending\s+trend|where did (?:my|our) money go)\b/i.test(message);
    const concept: BudgetConcept | null = inferred ?? (wholeBudget ? {
      label: 'All spending',
      categories: visibleCategories.filter((category) => !/credit card payments|internal master category|inflow|ready to assign/i.test(`${category.groupName} ${category.name}`)),
      matchedBy: 'concept' as const,
    } : null);
    if (!concept) return null;
    const range = requestedMonthRange(message, this.currentMonth());
    const today = this.today();
    const rollingDays = /\b(?:past|last)\s+(?:30|thirty)\s+days?\b/i.test(message);
    const fromDate = rollingDays ? this.shiftDate(today, -29) : range.fromMonth;
    const toDate = rollingDays ? today : range.toMonth === this.currentMonth() ? today : this.monthEnd(range.toMonth);
    const partialPeriod = !rollingDays && range.toMonth === this.currentMonth() && today < this.monthEnd(this.currentMonth());
    return this.spendingBreakdown(user, concept, rollingDays ? `${fromDate.slice(0, 7)}-01` : range.fromMonth, range.toMonth, spendingGrouping(message, range), {
      fromDate,
      toDate,
      transactionsOnly: rollingDays,
      partialPeriod,
      periodLabel: rollingDays ? 'the past 30 days' : undefined,
      comparison: /\b(compare|budget)\b/i.test(message),
    });
  }
  private spendingBreakdown(user: AppUser, concept: BudgetConcept, rawFromMonth: string, rawToMonth: string, grouping: SpendingGrouping, options: { fromDate?: string; toDate?: string; transactionsOnly?: boolean; partialPeriod?: boolean; periodLabel?: string; comparison?: boolean } = {}) {
    const scope = visibleScope(user);
    const validMonth = (value: string) => /^\d{4}-\d{2}(?:-01)?$/.test(value) ? `${value.slice(0, 7)}-01` : this.currentMonth();
    let fromMonth = validMonth(rawFromMonth); let toMonth = validMonth(rawToMonth);
    if (fromMonth > toMonth) [fromMonth, toMonth] = [toMonth, fromMonth];
    if (shiftMonth(fromMonth, 23) < toMonth) fromMonth = shiftMonth(toMonth, -23);
    const categoryIds = concept.categories.map((category) => category.id);
    const monthRows = this.database.db.select({ month: categoryMonths.month, categoryId: categories.id, category: categories.name, budgetedMilli: categoryMonths.budgetedMilli, activityMilli: categoryMonths.activityMilli })
      .from(categoryMonths).innerJoin(categories, eq(categories.id, categoryMonths.categoryId))
      .where(and(scope.categoryPredicate, inArray(categories.id, categoryIds), gte(categoryMonths.month, fromMonth), lte(categoryMonths.month, toMonth))).all();
    const fromDate = options.fromDate ?? fromMonth;
    const toDate = options.toDate ?? this.monthEnd(toMonth);
    const transactionRows = this.database.db.select({ date: transactions.date, categoryId: transactions.categoryId, category: transactions.categoryName, payee: transactions.payeeName, memo: transactions.memo, amountMilli: transactions.amountMilli })
      .from(transactions).where(and(scope.transactionPredicate, inArray(transactions.categoryId, categoryIds), gte(transactions.date, fromDate), lte(transactions.date, toDate), lt(transactions.amountMilli, 0), eq(transactions.deleted, false), isNull(transactions.transferAccountId)))
      .orderBy(desc(transactions.date)).all();

    const monthKeys: string[] = [];
    for (let month = fromMonth; month <= toMonth; month = shiftMonth(month, 1)) monthKeys.push(month);
    const activityByCategoryMonth = new Map(options.transactionsOnly ? [] : monthRows.map((row) => [`${row.categoryId}:${row.month}`, Math.abs(Math.min(0, row.activityMilli)) / 1000] as const));
    const transactionByCategoryMonth = new Map<string, number>();
    for (const row of transactionRows) {
      const key = `${row.categoryId}:${row.date.slice(0, 7)}-01`;
      transactionByCategoryMonth.set(key, (transactionByCategoryMonth.get(key) ?? 0) + Math.abs(row.amountMilli) / 1000);
    }
    const valueFor = (categoryId: string, month: string) => activityByCategoryMonth.get(`${categoryId}:${month}`) ?? transactionByCategoryMonth.get(`${categoryId}:${month}`) ?? 0;
    const allCategoryBreakdown = concept.categories.map((category) => ({
      label: category.name,
      categoryId: category.id,
      value: monthKeys.reduce((sum, month) => sum + valueFor(category.id, month), 0),
    }));
    const categoryBreakdown = allCategoryBreakdown.filter((row) => row.value > 0).map(({ label, value }) => ({ label, value }));
    const monthlyBreakdown = monthKeys.map((month) => ({
      label: month,
      value: concept.categories.reduce((sum, category) => sum + valueFor(category.id, month), 0),
    }));
    const rankedCategoryTotals = [...allCategoryBreakdown].filter((row) => row.value > 0).sort((left, right) => right.value - left.value);
    const detailedCategories = rankedCategoryTotals.length > 8 ? rankedCategoryTotals.slice(0, 7) : rankedCategoryTotals;
    const detailedCategoryIds = new Set(detailedCategories.map((row) => row.categoryId));
    const monthlyCategoryBreakdown = monthKeys.map((month) => {
      const segments = detailedCategories.map((category) => ({ label: category.label, value: valueFor(category.categoryId, month) })).filter((row) => row.value > 0);
      if (rankedCategoryTotals.length > 8) {
        const other = concept.categories.filter((category) => !detailedCategoryIds.has(category.id)).reduce((sum, category) => sum + valueFor(category.id, month), 0);
        if (other > 0) segments.push({ label: 'Other', value: other });
      }
      return { label: month, total: concept.categories.reduce((sum, category) => sum + valueFor(category.id, month), 0), segments };
    });
    const payees = new Map<string, number>();
    for (const row of transactionRows) {
      const payee = this.cleanMerchant(row.payee ?? 'Unknown merchant');
      payees.set(payee, (payees.get(payee) ?? 0) + Math.abs(row.amountMilli) / 1000);
    }
    const payeeBreakdown = [...payees].map(([label, value]) => ({ label, value })).sort((left, right) => right.value - left.value);
    const totalBudgeted = monthRows.reduce((sum, row) => sum + Math.max(0, row.budgetedMilli), 0) / 1000;
    const budgetByCategory = new Map<string, number>();
    for (const row of monthRows) budgetByCategory.set(row.categoryId, (budgetByCategory.get(row.categoryId) ?? 0) + Math.max(0, row.budgetedMilli) / 1000);
    return {
      subject: concept.label,
      label: concept.label,
      matched_by: concept.matchedBy,
      categories: concept.categories.map((category) => category.name),
      from_month: fromMonth,
      to_month: toMonth,
      grouping,
      total_spent: categoryBreakdown.reduce((sum, row) => sum + row.value, 0),
      total_budgeted: totalBudgeted,
      category_breakdown: categoryBreakdown,
      category_budget_breakdown: allCategoryBreakdown.map((row) => ({ label: row.label, spent: row.value, budget: budgetByCategory.get(row.categoryId) ?? 0 })),
      monthly_breakdown: monthlyBreakdown,
      monthly_category_breakdown: monthlyCategoryBreakdown,
      payee_breakdown: payeeBreakdown,
      from_date: fromDate,
      to_date: toDate,
      partial_period: Boolean(options.partialPeriod),
      period_label: options.periodLabel,
      comparison: Boolean(options.comparison),
      transactions: transactionRows.slice(0, 50).map((row) => ({ date: row.date, payee: this.cleanMerchant(row.payee ?? 'Unknown merchant'), category: row.category?.trim(), amount: Math.abs(row.amountMilli) / 1000, ...(row.memo ? { memo: row.memo } : {}) })),
    };
  }
  private monthEnd(month: string): string {
    const [year, monthNumber] = month.split('-').map(Number);
    return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  }
  private shiftDate(date: string, amount: number): string {
    const shifted = new Date(`${date}T12:00:00Z`);
    shifted.setUTCDate(shifted.getUTCDate() + amount);
    return shifted.toISOString().slice(0, 10);
  }
  private cleanMerchant(value: string): string {
    return cleanMerchantName(value);
  }
  private focusedAnswer(result: ReturnType<ChatService['spendingBreakdown']>) {
    const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    const monthLabel = (month: string, includeYear = true) => new Intl.DateTimeFormat('en-US', { month: 'long', ...(includeYear ? { year: 'numeric' as const } : {}), timeZone: 'UTC' }).format(new Date(`${month}T12:00:00Z`));
    const sameYear = result.from_month.slice(0, 4) === result.to_month.slice(0, 4);
    const period = result.period_label
      ? `over ${result.period_label}`
      : result.partial_period && result.from_month === result.to_month
        ? `so far in ${monthLabel(result.from_month)}`
        : result.from_month === result.to_month
          ? `in ${monthLabel(result.from_month)}`
          : `from ${monthLabel(result.from_month, !sameYear)} through ${monthLabel(result.to_month)}`;
    const wholeBudget = result.label === 'All spending';
    const rankedDetails = [...result.category_breakdown].sort((left, right) => right.value - left.value);
    const displayedDetails = rankedDetails.length > 5
      ? [...rankedDetails.slice(0, 4), { label: 'Other', value: rankedDetails.slice(4).reduce((sum, row) => sum + row.value, 0) }]
      : rankedDetails;
    const detail = displayedDetails.length > 1 ? ` (${displayedDetails.map((row) => `${row.label} ${money.format(row.value)}`).join(' + ')})` : '';
    const answer = result.comparison
      ? `${money.format(result.total_spent)} spent against ${money.format(result.total_budgeted)} budgeted for ${result.label} ${period}${detail}.`
      : `${money.format(result.total_spent)} spent${wholeBudget ? '' : ` on ${result.label}`} ${period}${detail}.`;
    const needsCompletedPeriod = result.total_spent === 0 || result.transactions.length === 0 || result.partial_period;
    const noun = result.grouping === 'transactions' ? `${result.label} transactions` : result.label;
    const transactionQuestion = transactionQueryFor(result, result.label) ?? `Show me ${result.label} transactions`;
    const followups = wholeBudget
      ? [`Show all transactions from ${result.from_month.slice(0, 7)} through ${result.to_month.slice(0, 7)}`, `Break down ${monthQueryLabel(result.to_month)} spending by category`, 'Show my spending trend over the previous six months']
      : needsCompletedPeriod
        ? [`Show ${noun} from the past 30 days`, `Show ${noun} last month`, `Show ${noun} over the previous three months`]
        : [transactionQuestion, `Show ${result.label} over the previous three months`, `Compare ${result.label} with its budget`];
    return { answer_md: answer, chart: chartForSpendingBreakdown(result), followups };
  }
  private mockAnswer(message: string, summary: ReturnType<ChatService['monthSummary']>) {
    const totalSpent = Math.abs(summary.reduce((sum, row) => sum + row.activity, 0)) / 1000;
    const totalBudget = summary.reduce((sum, row) => sum + row.budgeted, 0) / 1000;
    const lower = message.toLowerCase();
    const ranked = [...summary].sort((left, right) => left.activity - right.activity).map((row) => ({ label: row.name, value: Math.abs(row.activity) / 1000 }));
    const slices = ranked.length > 7 ? [...ranked.slice(0, 6), { label: 'Other', value: ranked.slice(6).reduce((sum, row) => sum + row.value, 0) }] : ranked;
    const chart: ChartSpec = lower.includes('where')
      ? { type: 'category_donut', slices }
      : { type: 'bar_vs_budget', series: summary.map((row) => ({ label: row.name, spent: Math.abs(row.activity) / 1000 })), budget: totalBudget };
    return { answer_md: `$${totalSpent.toFixed(2)} spent against $${totalBudget.toFixed(2)} assigned this month.`, chart, followups: ['Show the transactions', 'Compare last month', 'What is running hot?'] };
  }
}
