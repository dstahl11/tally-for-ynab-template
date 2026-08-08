const PREFIXES = [/^SQ \*/, /^SPO\*/, /^TST\*\s*/, /^PY \*/, /^DD \*/, /^SP\s+/];

export function normalizePayee(raw: string | null | undefined): string {
  let value = (raw ?? '').trim().toUpperCase();
  for (const prefix of PREFIXES) value = value.replace(prefix, '');
  value = value
    .replace(/^AMZN MKTP US\*[A-Z0-9]+\s*/i, 'AMAZON ')
    .replace(/\s+\d{2}\/\d{2}$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return value;
}
