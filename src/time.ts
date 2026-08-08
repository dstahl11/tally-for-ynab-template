export function dateKeyInTimeZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function monthKeyInTimeZone(timeZone: string, now = new Date()): string {
  return `${dateKeyInTimeZone(timeZone, now).slice(0, 7)}-01`;
}

export function shiftMonth(month: string, amount: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function daysLeftInMonth(timeZone: string, now = new Date()): number {
  const [year, month, day] = dateKeyInTimeZone(timeZone, now).split('-').map(Number);
  return Math.max(0, new Date(Date.UTC(year, month, 0)).getUTCDate() - day);
}
