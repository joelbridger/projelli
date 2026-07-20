import { BRAND } from './brand';

export const LOCAL_AI_NAME = `${BRAND.name} Local AI`;

export function brandText(text: string): string {
  return text
    .replace(/\bLantern Local AI\b/g, LOCAL_AI_NAME)
    .replace(/\bLantern AI\b/g, BRAND.messaging.redlineAuthor)
    .replace(/\bLantern's\b/g, BRAND.possessive)
    .replace(/\bLantern’s\b/g, BRAND.possessive)
    .replace(/\bLantern\b/g, BRAND.name)
    .replace(/\{\{localAiName\}\}/g, LOCAL_AI_NAME)
    .replace(/\{\{productAiName\}\}/g, BRAND.messaging.redlineAuthor)
    .replace(/\{\{productNamePossessive\}\}/g, BRAND.possessive)
    .replace(/\{\{productName\}\}/g, BRAND.name);
}

function brandUnknown(value: unknown): unknown {
  if (typeof value === 'string') return brandText(value);
  if (Array.isArray(value)) return value.map((item: unknown) => brandUnknown(item));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      result[key] = brandUnknown(child);
    }
    return result;
  }
  return value;
}

export function brandValue<T>(value: T): T {
  return brandUnknown(value) as T;
}
