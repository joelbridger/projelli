// Type declarations for translate-i18n.mjs (plain JS, no inline types).
// This file carries no runtime code — it exists purely so TypeScript
// consumers (currently: tests/integration/i18n/translation-roundtrip.test.ts)
// can typecheck against the script's exported helpers instead of falling
// back to implicit `any`.

export type LocaleValue = string | boolean;
export type NestedLocale = { [key: string]: LocaleValue | NestedLocale };

export function flatten(obj: NestedLocale, prefix?: string): Record<string, LocaleValue>;
export function unflatten(map: Record<string, LocaleValue>): NestedLocale;
export function pickMissing(
  en: NestedLocale,
  existing: NestedLocale,
): { missing: [string, string][]; carryOver: Record<string, LocaleValue> };
export function sha256(s: string): string;
export function extractJson(text: string): Record<string, unknown>;
export function estimateTokens(s: string): number;
export function parseFlags(argv: string[]): {
  dryRun: boolean;
  maxTokens: number;
  batchSize: number;
  locales: string[];
  model: string;
};
// A translated leaf gains `__sourceHash` / `__locked` siblings at the same
// nesting level; only object leaves (not plain string/boolean leaves) can
// carry those, hence the conditional.
type WithMeta<V> = V extends Record<string, unknown> ? V & Record<string, LocaleValue> : V;

export function translateLocale<T extends NestedLocale>(
  client: unknown,
  locale: string,
  en: T,
  existing: NestedLocale,
  flags: { dryRun: boolean; batchSize: number; maxTokens: number; model: string },
  costTracker: { estimatedTokens: number; actualInputTokens: number; actualOutputTokens: number },
): Promise<{ [K in keyof T]: WithMeta<T[K]> }>;
