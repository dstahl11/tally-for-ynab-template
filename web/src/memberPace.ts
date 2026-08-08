type PaceCategory = {
  budgetedMilli: number;
  balanceMilli: number;
  spentMilli: number;
  pace: number | null;
};

export function memberPaceSummary(data: { month: string; daysLeft: number; availableCategories: PaceCategory[] }) {
  const tracked = data.availableCategories.filter((category) => category.budgetedMilli > 0);
  const overspent = tracked.filter((category) => category.balanceMilli < 0);
  const [year, month] = data.month.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const elapsedShare = Math.max(1, daysInMonth - data.daysLeft) / daysInMonth;
  const runningHot = tracked.filter((category) => category.pace !== null && category.spentMilli > 0 && category.pace > Math.min(1, elapsedShare + .15));
  const availableMilli = tracked.reduce((total, category) => total + category.balanceMilli, 0);
  const assignedMilli = tracked.reduce((total, category) => total + category.budgetedMilli, 0);

  if (overspent.length) return { tone: 'off-rails', label: 'Off the rails', detail: `${overspent.length} ${overspent.length === 1 ? 'category is' : 'categories are'} over the available amount.`, attention: overspent.length, availableMilli, assignedMilli, tracked: tracked.length };
  if (runningHot.length) return { tone: 'running-hot', label: 'Running hot', detail: `${runningHot.length} ${runningHot.length === 1 ? 'category is' : 'categories are'} spending faster than the month is moving.`, attention: runningHot.length, availableMilli, assignedMilli, tracked: tracked.length };
  return { tone: 'on-track', label: 'On track', detail: 'Your spending is comfortably within this month’s pace.', attention: 0, availableMilli, assignedMilli, tracked: tracked.length };
}
