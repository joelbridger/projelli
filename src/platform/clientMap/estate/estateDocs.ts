// Estate-document recognition + beneficiary evidence extraction. Pure,
// dependency-free, conservative — same philosophy as sourceProvenance.ts
// (src/platform/rag/sourceProvenance.ts): a strong signal (filename OR the
// document's own heading structure), never a passing mention. Document text is
// DATA in, typed values out; nothing here ever reaches a prompt.
import type { ClientMap, ClientMapItem, SourceRef } from '@/platform/clientMap/types';

export type EstateDocKind = 'will' | 'trust' | 'beneficiary-designation' | 'poa';

export interface EstateDocEvidence {
  kind: EstateDocKind;
  docDateIso: string | null;
  parties: string[];
  accountHint: string | null;
  source: SourceRef;
  confidence: 'high' | 'medium';
}

const HEADING_SIGNALS: Array<[EstateDocKind, RegExp]> = [
  ['beneficiary-designation', /\bBENEFICIARY\s+DESIGNATION\b/i],
  ['trust', /\b(REVOCABLE|IRREVOCABLE|LIVING)\s+TRUST\b|\bTRUST\s+AGREEMENT\b/i],
  ['will', /\bLAST\s+WILL\s+AND\s+TESTAMENT\b/i],
  ['poa', /\b(DURABLE\s+)?POWER\s+OF\s+ATTORNEY\b/i],
];
const FILENAME_SIGNALS: Array<[EstateDocKind, RegExp]> = [
  ['beneficiary-designation', /benef/i],
  ['trust', /trust/i],
  ['will', /\bwill\b|last-will/i],
  ['poa', /\bpoa\b|power-of-attorney/i],
];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Connector source-ref schemes (SourceRef['kind'] minus 'document'), e.g.
 *  `mail:<id>`, `crm:<kind>:<id>`. A Windows absolute path also contains a
 *  colon (`C:\...`), so filename classification must reject THESE specific
 *  scheme prefixes, not any colon. */
const CONNECTOR_SCHEME_RE = /^(mail|crm|onedrive|esign|meeting|box|jotform|sharefile|zocks|addepar):/i;

function parseLongDate(text: string): string | null {
  const m = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(text);
  if (!m) return null;
  const monthName = m[1] ?? '';
  const day = m[2] ?? '';
  const year = m[3] ?? '';
  const month = MONTHS.indexOf(monthName.toLowerCase()) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(parseInt(day, 10)).padStart(2, '0')}`;
}

export function classifyEstateSource(input: { path: string; text: string }):
  | { kind: EstateDocKind; docDateIso: string | null; confidence: 'high' | 'medium' }
  | null {
  // Heading in the body = high confidence (the doc announces itself).
  for (const [kind, re] of HEADING_SIGNALS) {
    if (re.test(input.text)) return { kind, docDateIso: parseLongDate(input.text), confidence: 'high' };
  }
  // Filename signal alone: medium, and ONLY for unambiguous names on document
  // paths (never mail:/crm:/etc connector refs) — conservative by design.
  // NOT a blanket colon check: a Windows absolute path (C:\...) has one too.
  if (!CONNECTOR_SCHEME_RE.test(input.path)) {
    const base = input.path.split('/').pop() ?? '';
    for (const [kind, re] of FILENAME_SIGNALS) {
      if (re.test(base) && /\.(pdf|docx?)$/i.test(base)) {
        return { kind, docDateIso: parseLongDate(input.text), confidence: 'medium' };
      }
    }
  }
  return null;
}

const PARTY_RE = /(?:primary\s+)?beneficiar(?:y|ies)[^.:]*[:\s]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g;
const ACCOUNT_RE = /\b(rollover\s+IRA|IRA|Roth\s+IRA|401\(?k\)?|403\(?b\)?|annuity|life\s+insurance)\b/i;
const LIFE_EVENT_RE = /\b(married|divorced|passed\s+away|died|remarried)\b/i;

function partiesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PARTY_RE)) {
    const name = m[1];
    if (name !== undefined) out.push(name);
  }
  return [...new Set(out)];
}

export function extractBeneficiaryEvidence(map: ClientMap): {
  estate: EstateDocEvidence[];
  accountMentions: { account: string; source: SourceRef }[];
  lifeEvents: { event: string; dateIso: string | null }[];
} {
  const items: ClientMapItem[] = map.sections.flatMap((s) => s.items);

  // Pass 1: aggregate ALL text referencing the same source ref. The same
  // document can be introduced by one Client Map item with just its title and
  // date, while a LATER item's snippet of that same ref carries the actual
  // beneficiary names — classifying/extracting from only the first occurrence
  // would silently miss that evidence.
  const byRef = new Map<string, { texts: string[]; source: SourceRef }>();
  for (const it of items) {
    for (const src of it.sources) {
      const text = `${it.text}\n${src.snippet}`;
      const existing = byRef.get(src.ref);
      if (existing) existing.texts.push(text);
      else byRef.set(src.ref, { texts: [text], source: src });
    }
  }

  const estate: EstateDocEvidence[] = [];
  const accountMentions: { account: string; source: SourceRef }[] = [];
  const lifeEvents: { event: string; dateIso: string | null }[] = [];
  for (const { texts, source } of byRef.values()) {
    const combined = texts.join('\n');
    const cls = classifyEstateSource({ path: source.ref, text: combined });
    if (cls) {
      estate.push({
        ...cls,
        parties: partiesIn(combined),
        accountHint: ACCOUNT_RE.exec(combined)?.[1] ?? null,
        source,
      });
    } else {
      const acct = ACCOUNT_RE.exec(combined);
      if (acct?.[1] !== undefined) accountMentions.push({ account: acct[1], source });
    }
    const ev = LIFE_EVENT_RE.exec(combined);
    if (ev?.[1] !== undefined) lifeEvents.push({ event: ev[1].toLowerCase().replace(/\s+/g, ' '), dateIso: parseLongDate(combined) });
  }
  return { estate, accountMentions, lifeEvents };
}
