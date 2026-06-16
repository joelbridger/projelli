// Pure leaf helpers + shared types extracted from DocxEditor.tsx
// (behavior-preserving 3.0 reorg). No React / component dependencies.

/** A human summary of the last AI redline, shown in the results panel. */
export interface RedlineSummary {
  instruction: string;
  applied: number;
  skipped: number;
  items: { applied: boolean; reason: string; op: string; error?: string }[];
}

/** structuredClone with a JSON fallback for older runtimes / jsdom. */
export function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Pull human-readable text out of a small OOXML fragment by concatenating
 * `<w:t>...</w:t>` runs. Purely for display of preserved inlines (hyperlinks,
 * fields). Returns '' if none. Never throws; never used for structure.
 */
export function extractLooseText(xml: string): string {
  let out = '';
  const re = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out += decodeXmlEntities(m[1] ?? '');
  }
  return out;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
