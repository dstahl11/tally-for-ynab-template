import { describe, expect, it } from 'vitest';
import { memberPaceSummary } from '../web/src/memberPace';

const category = (overrides: Partial<{ budgetedMilli: number; balanceMilli: number; spentMilli: number; pace: number | null }> = {}) => ({
  budgetedMilli: 100_000,
  balanceMilli: 100_000,
  spentMilli: 0,
  pace: 0,
  ...overrides,
});

describe('member pace summary', () => {
  it('reports on track when scoped spending follows the month', () => {
    const result = memberPaceSummary({ month: '2026-08', daysLeft: 20, availableCategories: [category({ budgetedMilli: 100_000, balanceMilli: 80_000, spentMilli: 20_000, pace: .2 }), category({ budgetedMilli: 75_000, balanceMilli: 60_000, spentMilli: 15_000, pace: .2 })] });
    expect(result.label).toBe('On track');
    expect(result.assignedMilli).toBe(175_000);
  });

  it('reports running hot before a category is overspent', () => {
    expect(memberPaceSummary({ month: '2026-08', daysLeft: 20, availableCategories: [category({ balanceMilli: 45_000, spentMilli: 55_000, pace: .55 })] }).label).toBe('Running hot');
  });

  it('reports off the rails when a scoped category has a negative balance', () => {
    const result = memberPaceSummary({ month: '2026-08', daysLeft: 20, availableCategories: [category({ balanceMilli: -10_000, spentMilli: 110_000, pace: 1.1 })] });
    expect(result.label).toBe('Off the rails');
    expect(result.attention).toBe(1);
  });
});
