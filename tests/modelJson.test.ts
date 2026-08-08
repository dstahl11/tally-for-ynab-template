import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseModelJson, plainTextAnswer } from '../src/ai/modelJson.js';
import { chartForToolResults, inferBudgetConcept, requestedMonthRange } from '../src/chat/service.js';
import { dateKeyInTimeZone, monthKeyInTimeZone, shiftMonth } from '../src/time.js';

describe('model response cleanup', () => {
  it('extracts fenced JSON even when the model adds prose first', () => {
    const schema = z.object({ answer_md: z.string() });
    const parsed = parseModelJson('Here is the answer.\n```json\n{"answer_md":"**$250 remaining**"}\n```', schema);
    expect(plainTextAnswer(parsed.answer_md)).toBe('$250 remaining');
  });

  it('removes fenced spillover from a plain-text fallback', () => {
    expect(plainTextAnswer('Useful answer.\n```json\n{"ignored":true}\n```')).toBe('Useful answer.');
  });
});

describe('household timezone', () => {
  it('keeps the household in July during the UTC-only August boundary', () => {
    const boundary = new Date('2026-08-01T03:30:00.000Z');
    expect(dateKeyInTimeZone('America/New_York', boundary)).toBe('2026-07-31');
    expect(monthKeyInTimeZone('America/New_York', boundary)).toBe('2026-07-01');
    expect(shiftMonth('2026-07-01', -1)).toBe('2026-06-01');
  });
});

describe('budget intelligence', () => {
  it('creates a visual when a tool returns chartable data', () => {
    expect(chartForToolResults([{ name: 'get_month_summary', result: { categories: [{ category: 'Food', activity: -125 }, { category: 'Clothing', activity: -80 }] } }])?.type).toBe('category_donut');
    expect(chartForToolResults([{ name: 'get_pace', result: { remaining: 250, days_left: 10, daily_rate: 25, verdict: 'ok' } }])?.type).toBe('stat_card');
  });

  it('resolves outdoor language to Adventure Travel & Gear', () => {
    const catalog = [
      { id: 'adventure', name: 'Adventure Travel & Gear', groupName: 'Quality of Life' },
      { id: 'clothing', name: 'Member Clothing', groupName: 'Member' },
    ];
    expect(inferBudgetConcept('How much did I spend skiing last month?', catalog)?.categories.map((category) => category.id)).toEqual(['adventure']);
    expect(inferBudgetConcept('Show my bike purchases', catalog)?.label).toBe('Adventure Travel & Gear');
  });

  it('resolves broad concepts to all relevant scoped categories', () => {
    const catalog = [
      { id: 'netflix', name: 'Netflix', groupName: 'Just for Fun' },
      { id: 'movies', name: 'Movies', groupName: 'Just for Fun' },
      { id: 'groceries', name: 'Groceries', groupName: 'Everyday' },
      { id: 'dining', name: 'Family eating out', groupName: 'Everyday' },
      { id: 'rent', name: 'Rent', groupName: 'Bills' },
    ];
    expect(inferBudgetConcept('entertainment last month', catalog)?.categories.map((category) => category.id)).toEqual(['netflix', 'movies']);
    expect(inferBudgetConcept('food overall last month', catalog)?.categories.map((category) => category.id)).toEqual(['groceries', 'dining']);
    expect(inferBudgetConcept('show me food transactions last month', catalog)?.categories.map((category) => category.id)).toEqual(['groceries', 'dining']);
    expect(inferBudgetConcept('show my food spending over the last three months', catalog)?.label).toBe('Food');
  });

  it('uses relative month language and keeps focused charts ahead of broad summaries', () => {
    expect(requestedMonthRange('last month', '2026-08-01')).toEqual({ fromMonth: '2026-07-01', toMonth: '2026-07-01' });
    expect(requestedMonthRange('over the last three months', '2026-08-01')).toEqual({ fromMonth: '2026-05-01', toMonth: '2026-07-01' });
    expect(requestedMonthRange('over the previous three months', '2026-08-01')).toEqual({ fromMonth: '2026-05-01', toMonth: '2026-07-01' });
    expect(requestedMonthRange('from 2026-05 through 2026-07', '2026-08-01')).toEqual({ fromMonth: '2026-05-01', toMonth: '2026-07-01' });
    const chart = chartForToolResults([
      { name: 'get_spending_breakdown', result: { label: 'Food', grouping: 'category', category_breakdown: [{ label: 'Groceries', value: 100 }, { label: 'Dining', value: 50 }], total_budgeted: 200 } },
      { name: 'get_month_summary', result: { categories: [{ category: 'Rent', activity: -5000 }] } },
    ]);
    expect(chart).toMatchObject({ type: 'category_donut', title: 'Food spending' });
    expect(JSON.stringify(chart)).not.toContain('Rent');
  });

  it('uses detailed stacked bars for short multi-month category comparisons', () => {
    const chart = chartForToolResults([{ name: 'get_spending_breakdown', result: {
      label: 'Food', grouping: 'month', monthly_breakdown: [{ label: '2026-05-01', value: 200 }, { label: '2026-06-01', value: 300 }, { label: '2026-07-01', value: 250 }],
      monthly_category_breakdown: [
        { label: '2026-05-01', total: 200, segments: [{ label: 'Groceries', value: 120 }, { label: 'Dining', value: 80 }] },
        { label: '2026-06-01', total: 300, segments: [{ label: 'Groceries', value: 200 }, { label: 'Dining', value: 100 }] },
        { label: '2026-07-01', total: 250, segments: [{ label: 'Groceries', value: 150 }, { label: 'Dining', value: 100 }] },
      ],
    } }]);
    expect(chart).toMatchObject({ type: 'monthly_category_bars', title: 'Food by month' });
  });

  it('keeps the chart period in category transaction drill-downs', () => {
    const chart = chartForToolResults([{ name: 'get_spending_breakdown', result: {
      label: 'Food', grouping: 'category', period_label: 'the past 30 days', from_month: '2026-07-01', to_month: '2026-08-01',
      category_breakdown: [{ label: 'Groceries', value: 388 }, { label: 'Family eating out', value: 866 }],
    } }]);
    expect(chart).toMatchObject({ type: 'category_donut', slices: [
      { label: 'Family eating out', query: 'Show Family eating out transactions from the past 30 days' },
      { label: 'Groceries', query: 'Show Groceries transactions from the past 30 days' },
    ] });
  });
});
