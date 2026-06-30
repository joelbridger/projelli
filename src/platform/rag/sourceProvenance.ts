/**
 * sourceProvenance — recognize the OUTPUT of external advisor tools inside the
 * generic evidence pile.
 *
 * Keepance does NOT integrate with RightCapital or Jump. It reads the files and
 * notes those tools *export or sync* — a RightCapital plan PDF the advisor saved
 * into a client folder, a Jump meeting note that arrived in Wealthbox or a
 * SharePoint folder — once they have landed in a place Keepance already watches
 * (files, email, CRM, cloud drive). This module is the "this came from
 * RightCapital / Jump" recognizer the strategy doc calls for:
 *
 *   docs/strategy/2026-06-29-connector-access-options-rightcapital-jump.md
 *
 * Design rules from that doc, made concrete here:
 *   - Recognized SOURCE TYPES, not branded connectors. Pure, dependency-free,
 *     unit-tested — the same shape as matterResolver.ts. No Rust, no new RAG
 *     source_type, no change to the ingestion path.
 *   - HONEST, never overclaiming. We recognize an *exported snapshot*, so we
 *     surface the export/report date and treat a plan as point-in-time, never
 *     "live". Labels say "exported"/"saved", never "integrated".
 *   - CONSERVATIVE. An ordinary email or note that merely *mentions* a tool must
 *     not be tagged as that tool's export. Recognition therefore needs a strong
 *     signal (the export filename, or the tool's own branding in the document
 *     body together with the document's structure) — not a passing mention.
 *
 * Recognition runs at retrieval/answer time over a RAG hit's path + chunk text +
 * source type, so it covers every arrival path uniformly (local watched folder,
 * OneDrive/SharePoint, Wealthbox, email attachments) without touching any
 * connector.
 */

/** The external tools whose output Keepance recognizes. */
export type ExternalTool = 'rightcapital' | 'jump';

/** What the recognized export is. */
export type ExternalKind = 'plan' | 'meeting-note';

export interface RecognizedProvenance {
  /** Machine id of the originating tool. */
  tool: ExternalTool;
  /** Human label for UI/copy ("RightCapital" | "Jump"). */
  toolLabel: string;
  /** What kind of artifact this is. */
  kind: ExternalKind;
  /**
   * ISO date (YYYY-MM-DD) the artifact was exported/generated (RightCapital) or
   * the meeting was held (Jump), when one could be detected. Absent when no
   * trustworthy date was found — the UI then shows the provenance without a date
   * rather than guessing.
   */
  exportedAt?: string;
  /** How sure we are. 'high' = filename or explicit branding; 'medium' = brand
   *  plus document structure; we never emit a match below that bar. */
  confidence: 'high' | 'medium';
}

export interface ProvenanceInput {
  /**
   * The source's path or resolvable id — a workspace-relative file path, a
   * `mail:<id>`, `crm:note:<id>`, `onedrive:<drive>:<item>`, etc. The basename
   * (or the trailing segment) is the strongest single recognition signal.
   */
  path?: string | undefined;
  /** Extracted/retrieved text to scan for branding + dates. */
  text?: string | undefined;
  /** The RAG source type, used as a weak prior (e.g. mail is never an export). */
  sourceType?: string | undefined;
}

const TOOL_LABELS: Record<ExternalTool, string> = {
  rightcapital: 'RightCapital',
  jump: 'Jump',
};

/** Human label for the tool. */
export function toolLabel(tool: ExternalTool): string {
  return TOOL_LABELS[tool];
}

/* -------------------------------------------------------------------------- */
/* Signals                                                                     */
/* -------------------------------------------------------------------------- */

/** RightCapital's brand, allowing an optional space ("Right Capital"). */
const RIGHTCAPITAL_BRAND_RE = /right\s?capital/i;

/** Plan-module headings that only appear in an actual RightCapital report, used
 *  to confirm a body-text match isn't just a passing mention of the brand. */
const RIGHTCAPITAL_STRUCTURE_RE =
  /\b(retirement analysis|cash flow|net worth|liquidity & survivability|monte carlo|estate (?:flow|analysis)|tax (?:strategies|projection)|insurance audit|education funding|blueprint|action items? & next steps|probability of success)\b/i;

/** Jump's unambiguous brand markers (domains / "Powered by Jump"). "Jump" alone
 *  is too common a word to rely on, so body recognition needs one of these. */
const JUMP_BRAND_RE = /\b(jump\.ai|jumpapp\.com|jumpapp|powered by jump|jump ai)\b/i;

/** Meeting-note structure that, with a Jump brand marker, confirms a Jump note. */
const JUMP_STRUCTURE_RE =
  /\b(meeting summary|action items?|next steps|attendees|follow[- ]ups?|key takeaways|discussion points?|client recap)\b/i;

/** Filename signal for a RightCapital export. */
function rightcapitalFilenameMatch(basename: string): boolean {
  return RIGHTCAPITAL_BRAND_RE.test(basename);
}

/** Filename signal for a Jump export. Requires "jump" to be qualified
 *  (jumpapp, jump-note, jump_meeting, jump.ai) so a file literally named
 *  "long-jump-results.pdf" is not mistaken for a Jump note. */
function jumpFilenameMatch(basename: string): boolean {
  return (
    /\bjump[\s_-]?(?:app|note|notes|meeting|recap|summary)\b/i.test(basename) ||
    /\bjumpapp\b/i.test(basename) ||
    /jump\.ai/i.test(basename)
  );
}

function basenameOf(path: string): string {
  const segs = path.split(/[\\/:]/);
  const last = segs[segs.length - 1];
  return last && last.length > 0 ? last : path;
}

/* -------------------------------------------------------------------------- */
/* Date extraction                                                             */
/* -------------------------------------------------------------------------- */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

/** Build an ISO date string only when the parts form a real calendar date. */
function isoDate(year: number, month: number, day: number): string | null {
  if (year < 1990 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null; // e.g. Feb 30 rolled over
  }
  return `${String(year)}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Find the most trustworthy date in a piece of text. Prefers a date that sits
 * next to a report/meeting label ("as of", "report date", "prepared on",
 * "generated", "meeting date"), then falls back to the first parseable date.
 * Returns ISO `YYYY-MM-DD` or null.
 */
export function extractExportDate(text: string | undefined): string | null {
  if (!text) return null;
  const sample = text.slice(0, 4000); // dates live in the header; cap the scan

  // 1) "Month DD, YYYY" / "Month DD YYYY"
  const monthName = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g;
  // 2) ISO-ish YYYY-MM-DD or YYYY/MM/DD
  const isoLike = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
  // 3) US MM/DD/YYYY or MM-DD-YYYY
  const usLike = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/g;

  const labelRe =
    /(as of|report date|prepared(?: on| for)?|generated(?: on)?|created(?: on)?|meeting date|date of meeting|dated|plan date)\b/i;

  type Found = { iso: string; index: number; labeled: boolean };
  const found: Found[] = [];

  const consider = (iso: string | null, index: number): void => {
    if (!iso) return;
    const before = sample.slice(Math.max(0, index - 40), index);
    found.push({ iso, index, labeled: labelRe.test(before) });
  };

  let m: RegExpExecArray | null;
  while ((m = monthName.exec(sample)) !== null) {
    const mon = MONTHS[(m[1] ?? '').toLowerCase()];
    if (mon === undefined) continue;
    consider(isoDate(Number(m[3]), mon, Number(m[2])), m.index);
  }
  while ((m = isoLike.exec(sample)) !== null) {
    consider(isoDate(Number(m[1]), Number(m[2]), Number(m[3])), m.index);
  }
  while ((m = usLike.exec(sample)) !== null) {
    consider(isoDate(Number(m[3]), Number(m[1]), Number(m[2])), m.index);
  }

  if (found.length === 0) return null;
  const labeled = found.filter((f) => f.labeled).sort((a, b) => a.index - b.index);
  const [firstLabeled] = labeled;
  if (firstLabeled) return firstLabeled.iso;
  found.sort((a, b) => a.index - b.index);
  const [firstFound] = found;
  return firstFound ? firstFound.iso : null;
}

/** Date embedded in a filename (e.g. `Plan-2026-06-12.pdf`, `plan_06-12-2026`). */
function extractDateFromFilename(basename: string): string | null {
  let m = /(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})/.exec(basename);
  if (m) {
    const iso = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) return iso;
  }
  m = /(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})/.exec(basename);
  if (m) {
    const iso = isoDate(Number(m[3]), Number(m[1]), Number(m[2]));
    if (iso) return iso;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Recognition                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Recognize whether a source is an exported RightCapital plan or a Jump meeting
 * note. Returns null for everything else (the overwhelming majority of the
 * pile). Conservative by design — see the module header.
 */
export function recognizeProvenance(input: ProvenanceInput): RecognizedProvenance | null {
  const { path, text, sourceType } = input;

  // Mail itself is never an export: RightCapital emails no report and Jump's
  // notification emails are content-free pings (per the strategy doc). A plan
  // PDF attached to an email is indexed as its own pdf/onedrive source, not as
  // `mail`. Short-circuit ALL mail here — both the body AND the filename signal —
  // so a message that merely mentions a tool (or whose subject leaks into the
  // path) is never mistagged as that tool's export.
  if (sourceType === 'mail') return null;

  const basename = path ? basenameOf(path) : '';

  // ---- RightCapital ----
  const rcByName = !!basename && rightcapitalFilenameMatch(basename);
  const rcBrandInBody = !!text && RIGHTCAPITAL_BRAND_RE.test(text);
  const rcStructInBody = !!text && RIGHTCAPITAL_STRUCTURE_RE.test(text);
  if (rcByName || (rcBrandInBody && rcStructInBody)) {
    const exportedAt =
      extractDateFromFilename(basename) ?? extractExportDate(text) ?? undefined;
    const provenance: RecognizedProvenance = {
      tool: 'rightcapital',
      toolLabel: TOOL_LABELS.rightcapital,
      kind: 'plan',
      confidence: rcByName ? 'high' : 'medium',
    };
    if (exportedAt) provenance.exportedAt = exportedAt;
    return provenance;
  }

  // ---- Jump ----
  const jumpByName = !!basename && jumpFilenameMatch(basename);
  const jumpBrandInBody = !!text && JUMP_BRAND_RE.test(text);
  const jumpStructInBody = !!text && JUMP_STRUCTURE_RE.test(text);
  if (jumpByName || (jumpBrandInBody && jumpStructInBody)) {
    const exportedAt =
      extractDateFromFilename(basename) ?? extractExportDate(text) ?? undefined;
    const provenance: RecognizedProvenance = {
      tool: 'jump',
      toolLabel: TOOL_LABELS.jump,
      kind: 'meeting-note',
      confidence: jumpByName ? 'high' : 'medium',
    };
    if (exportedAt) provenance.exportedAt = exportedAt;
    return provenance;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Freshness + dedupe + presentation                                          */
/* -------------------------------------------------------------------------- */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days between an ISO date and `now` (negative if the date is future). */
export function ageInDays(exportedAt: string, now: Date): number | null {
  const t = Date.parse(`${exportedAt}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / MS_PER_DAY);
}

/**
 * A recognized PLAN is "stale" when its export date is older than the limit.
 * Only plans are stale-eligible: a meeting note is inherently a point-in-time
 * record, so we date it but never alarm on its age. Unknown date → not stale
 * (we can't claim staleness we can't measure).
 */
export function isStalePlan(
  p: RecognizedProvenance,
  now: Date,
  maxAgeDays: number,
): boolean {
  if (p.kind !== 'plan' || !p.exportedAt) return false;
  const age = ageInDays(p.exportedAt, now);
  return age !== null && age > maxAgeDays;
}

/**
 * Stable key for collapsing the SAME recognized artifact that arrived through
 * two paths (e.g. a Jump note synced into Wealthbox AND saved as a SharePoint
 * PDF). Keyed by tool + kind + date + client, so genuinely different artifacts
 * stay separate. Returns null when there's no date to anchor on (we then keep
 * both rather than risk merging two distinct undated notes).
 */
export function provenanceDedupeKey(
  p: RecognizedProvenance,
  matterId?: string,
): string | null {
  const { exportedAt } = p;
  if (!exportedAt) return null;
  return `${p.tool}|${p.kind}|${exportedAt}|${matterId ?? ''}`;
}

/** Format an ISO date for display: "Jun 12, 2026". Pass-through if unparseable. */
export function formatExportDate(exportedAt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(exportedAt);
  const year = m?.[1];
  const month = m?.[2];
  const day = m?.[3];
  if (!year || !month || !day) return exportedAt;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = names[Number(month) - 1] ?? month;
  return `${mon} ${String(Number(day))}, ${year}`;
}

/** The verb that honestly describes how the artifact reached Keepance. */
function provenanceVerb(p: RecognizedProvenance): string {
  return p.kind === 'plan' ? 'exported' : 'saved';
}

/**
 * Short badge label for a citation card, e.g.
 *   "RightCapital · exported Jun 12, 2026"
 *   "Jump · saved meeting note"
 */
export function provenanceBadgeLabel(p: RecognizedProvenance): string {
  const verb = provenanceVerb(p);
  if (p.exportedAt) {
    return `${p.toolLabel} · ${verb} ${formatExportDate(p.exportedAt)}`;
  }
  return p.kind === 'plan'
    ? `${p.toolLabel} · exported plan`
    : `${p.toolLabel} · saved meeting note`;
}

export interface StalePlanNotice {
  toolLabel: string;
  exportedAt: string;
  ageDays: number;
}

/**
 * From a set of recognized provenances (typically the provenance of each
 * citation in an answer), return the distinct STALE plan snapshots, so the Ask
 * surface can show one honest "this relies on an old exported plan" warning.
 * De-duplicated by tool + date. Meeting notes are never included (a note is
 * inherently point-in-time and is dated, not alarmed).
 */
export function stalePlanNotices(
  provenances: ReadonlyArray<RecognizedProvenance | undefined>,
  now: Date,
  maxAgeDays: number,
): StalePlanNotice[] {
  const seen = new Set<string>();
  const out: StalePlanNotice[] = [];
  for (const p of provenances) {
    if (!p || !p.exportedAt || !isStalePlan(p, now, maxAgeDays)) continue;
    const key = `${p.tool}|${p.exportedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const age = ageInDays(p.exportedAt, now);
    out.push({ toolLabel: p.toolLabel, exportedAt: p.exportedAt, ageDays: age ?? 0 });
  }
  return out;
}

/**
 * One-line description for the model context block so the answer can state the
 * date and treat the source as a snapshot, e.g.
 *   "RightCapital plan, exported Jun 12, 2026 (point-in-time snapshot, 17 days old)"
 */
export function describeProvenanceForPrompt(
  p: RecognizedProvenance,
  now: Date,
): string {
  const kindWord = p.kind === 'plan' ? 'plan' : 'meeting note';
  const verb = provenanceVerb(p);
  if (!p.exportedAt) {
    return `${p.toolLabel} ${kindWord}, ${verb} from ${p.toolLabel} (point-in-time snapshot; export date not detected)`;
  }
  const age = ageInDays(p.exportedAt, now);
  const ageStr =
    age === null ? '' : age <= 0 ? ', today' : age === 1 ? ', 1 day old' : `, ${String(age)} days old`;
  return `${p.toolLabel} ${kindWord}, ${verb} ${formatExportDate(p.exportedAt)} (point-in-time snapshot${ageStr})`;
}
