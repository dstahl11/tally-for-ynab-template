export function cadenceArtifact(activityMilli: number, targetMilli: number): boolean {
  if (targetMilli <= 0) return false;
  const ratio = Math.abs(activityMilli) / targetMilli;
  return [2, 3, 4, 5].some((multiple) => Math.abs(ratio - multiple) / multiple <= 0.03);
}

export function subscriptionCreep(targetMilli: number, chargesMilli: number[]): number | null {
  if (chargesMilli.length < 3) return null;
  const latest = chargesMilli.slice(-3).map(Math.abs);
  if (!latest.every((charge) => charge === latest[0]) || latest[0] <= targetMilli) return null;
  if (cadenceArtifact(latest[0], targetMilli)) return null;
  return latest[0];
}

export function placeholderTarget(targetMilli: number, activityByMonth: number[]): number | null {
  const recent = activityByMonth.slice(-6).map(Math.abs);
  if (recent.length < 3 || !recent.slice(-3).every((activity) => activity > 2 * targetMilli)) return null;
  if (cadenceArtifact(recent.at(-1)!, targetMilli)) return null;
  const sorted = [...recent].sort((a, b) => a - b);
  const p75 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))];
  return Math.ceil(p75 / 5000) * 5000;
}
