import type { ZodType } from 'zod';

function candidates(text: string): string[] {
  const values = [text.trim()];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) values.push(match[1].trim());
  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) values.push(text.slice(objectStart, objectEnd + 1));
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) values.push(text.slice(arrayStart, arrayEnd + 1));
  return [...new Set(values.filter(Boolean))];
}

export function parseModelJson<T>(text: string, schema: ZodType<T>): T {
  for (const candidate of candidates(text)) {
    try {
      const parsed = schema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      // Models occasionally wrap valid JSON in prose or a fenced block; try the next candidate.
    }
  }
  throw new Error('model_json_invalid');
}

export function plainTextAnswer(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .trim();
}
