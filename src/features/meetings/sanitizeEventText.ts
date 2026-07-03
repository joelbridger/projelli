/**
 * Calendar event titles/descriptions are UNTRUSTED (anyone can send an
 * invite). Before event text reaches a model prompt it is sanitized and
 * fenced as data. The framing instruction lives in generateBrief.ts; this
 * module guarantees the fence itself cannot be closed from inside.
 */

const FENCE_OPEN = '<<<EVENT_DATA';
const FENCE_CLOSE = 'EVENT_DATA>>>';

export function sanitizeEventText(raw: string, maxLen = 600): string {
  return raw
    // Strip C0/C1 control chars except tab/newline/CR (those collapse below).
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    // Neutralize any fence-marker fragment so the block cannot be escaped.
    .replace(/EVENT_DATA/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/** Render labeled fields inside exactly one fence pair. */
export function fenceEventData(fields: { label: string; value: string }[]): string {
  const lines = fields
    .map((f) => `${f.label}: ${sanitizeEventText(f.value)}`)
    .join('\n');
  return `${FENCE_OPEN}\n${lines}\n${FENCE_CLOSE}`;
}
