/**
 * Recording Notice Kit — the verbal-notice matcher (the centerpiece).
 *
 * Given a meeting's transcript (the first few minutes, in practice), decide
 * whether the advisor actually SPOKE a recording notice — e.g. "I'm recording
 * this meeting for my notes, is that alright?". The point is evidence: the
 * notice lives in the meeting's own audio, in the advisor's voice, timestamped.
 *
 * Design (deliberate — people paraphrase, so this is NOT exact-string):
 *   1. Normalize each segment to lowercase content tokens (punctuation and
 *      apostrophe variants stripped).
 *   2. Semantic core: a RECORDING term used as a FIRST-PERSON disclosure with
 *      NO negation between the person marker and the verb. This is what makes
 *      "I'm recording this for notes" pass while "they record everything" and
 *      "I never record" both fail.
 *   3. Custom firm phrases (from the firm-customizable script setting) add a
 *      second, overlap-based detector so an unusually-worded firm script is
 *      still recognized even if it avoids the literal word "record".
 *   4. Confidence rewards the fuller notices (a purpose — "for my notes" — and
 *      a consent ask — "is that alright with everyone?").
 *
 * Fully local: this only ever reads the on-device transcript. Nothing leaves
 * the machine. This is guidance/evidence, never a legal judgment.
 */

export interface NoticeSegmentInput {
  /** Milliseconds into the recording where this segment begins. */
  startMs: number;
  text: string;
}

export interface NoticeMatch {
  /** Audio timestamp (ms) of the segment the notice was found in. */
  atMs: number;
  /** The transcript text that matched — the human-readable evidence snippet. */
  snippet: string;
  /** 0.5–1.0 for a match; higher for a fuller, clearer notice. */
  confidence: number;
}

export type NoticeLocale = 'en' | 'de' | 'es';

export interface DetectOptions {
  locale?: NoticeLocale;
  /** The firm's expected notice phrase(s) — its custom script. Fed to the
   *  overlap detector so an atypically-worded script still verifies. */
  customPhrases?: string[];
  /** Only consider segments starting strictly before this ms offset. Omit to
   *  scan every provided segment (the caller usually pre-slices instead). */
  windowMs?: number;
}

interface LangConfig {
  /** Any of these tokens counts as a "recording" term. */
  recordingTerms: ReadonlySet<string>;
  /** Recording terms that are inherently first-person (e.g. Spanish "grabo" =
   *  "I record"), so no separate subject marker is required. */
  firstPersonTerms: ReadonlySet<string>;
  /** Separate tokens that establish a first-person subject/intent near the
   *  recording verb ("i", "i'm", "let", "me", "we", "going", …). */
  firstPersonMarkers: ReadonlySet<string>;
  /** Third-person / second-person subjects ("they", "you", "he", "she") — if
   *  one of these is the CLOSEST subject before the recording verb, it isn't a
   *  first-person disclosure ("they record everything", "did you record"). */
  thirdPersonMarkers: ReadonlySet<string>;
  /** Tokens that negate the disclosure ("never", "not", "won't", …). */
  negations: ReadonlySet<string>;
  /** German separable-verb support: "nehme … auf" / "zeichne … auf" — when a
   *  particle token appears in the segment alongside one of these stems, treat
   *  it as a recording term. Empty for languages that don't need it. */
  separableStems?: ReadonlySet<string>;
  separableParticles?: ReadonlySet<string>;
  /** Purpose tokens ("notes"), rewarded in confidence. */
  purposeTokens: ReadonlySet<string>;
  /** Consent-ask tokens ("everyone", "alright", "okay"), rewarded. */
  consentTokens: ReadonlySet<string>;
  /** Stopwords dropped before computing custom-phrase overlap. */
  stopwords: ReadonlySet<string>;
}

const LANGS: Record<NoticeLocale, LangConfig> = {
  en: {
    recordingTerms: new Set(['record', 'recording', 'recorded', 'records']),
    firstPersonTerms: new Set(),
    firstPersonMarkers: new Set(['i', 'im', 'ill', 'id', 'ive', 'let', 'me', 'we', 'were', 'well', 'going', 'gonna', 'wanna', 'want']),
    thirdPersonMarkers: new Set(['they', 'you', 'he', 'she', 'it', 'someone', 'somebody', 'people', 'everybody', 'nobody', 'who', 'court']),
    negations: new Set(['not', 'never', 'dont', 'wont', 'cant', 'cannot', 'no', 'without', 'stop', 'stopped', 'asked']),
    purposeTokens: new Set(['note', 'notes', 'notetaking', 'record-keeping', 'notekeeping']),
    consentTokens: new Set(['everyone', 'alright', 'okay', 'ok', 'consent', 'agree', 'anyone', 'objection', 'all']),
    stopwords: new Set(['the', 'a', 'an', 'this', 'that', 'is', 'are', 'be', 'being', 'for', 'my', 'our', 'and', 'of', 'to', 'on', 'in', 'so', 'just', 'now', 'today', 'we', 'i', 'im']),
  },
  de: {
    recordingTerms: new Set(['aufnehmen', 'aufnahme', 'aufnehme', 'aufnimmt', 'aufzeichnen', 'aufzeichnung', 'aufgezeichnet', 'aufzeichne']),
    firstPersonTerms: new Set(),
    firstPersonMarkers: new Set(['ich', 'wir', 'lass', 'werde', 'werden', 'mochte', 'mochten', 'will']),
    thirdPersonMarkers: new Set(['sie', 'er', 'es', 'man', 'du', 'ihr', 'jemand', 'leute', 'wer']),
    negations: new Set(['nicht', 'nie', 'niemals', 'kein', 'keine', 'ohne']),
    separableStems: new Set(['nehme', 'nimmt', 'nehmen', 'zeichne', 'zeichnen']),
    separableParticles: new Set(['auf']),
    purposeTokens: new Set(['notizen', 'notiz', 'protokoll', 'aufzeichnungen']),
    consentTokens: new Set(['alle', 'einverstanden', 'ordnung', 'okay', 'ok', 'zustimmung', 'jemand']),
    stopwords: new Set(['der', 'die', 'das', 'ein', 'eine', 'dieses', 'diese', 'ist', 'sind', 'fur', 'meine', 'mein', 'unsere', 'und', 'von', 'zu', 'auf', 'so', 'jetzt', 'heute', 'wir', 'ich']),
  },
  es: {
    recordingTerms: new Set(['grabar', 'grabando', 'grabacion', 'grabaciones', 'grabo', 'grabare', 'graba', 'graban', 'grabada', 'grabado', 'grabamos']),
    firstPersonTerms: new Set(['grabo', 'grabare', 'grabando', 'grabamos']),
    firstPersonMarkers: new Set(['estoy', 'voy', 'vamos', 'quiero', 'me', 'yo']),
    thirdPersonMarkers: new Set(['ellos', 'ellas', 'el', 'ella', 'usted', 'ustedes', 'alguien', 'gente', 'tu', 'quien']),
    negations: new Set(['no', 'nunca', 'jamas', 'sin']),
    purposeTokens: new Set(['notas', 'nota', 'apuntes']),
    consentTokens: new Set(['todos', 'acuerdo', 'bien', 'ok', 'okay', 'consentimiento', 'alguien']),
    stopwords: new Set(['el', 'la', 'los', 'las', 'un', 'una', 'este', 'esta', 'es', 'son', 'para', 'mi', 'mis', 'nuestra', 'y', 'de', 'a', 'en', 'asi', 'ahora', 'hoy', 'yo']),
  },
};

/** How far back from a recording verb to hunt for its subject. Larger than a
 *  typical clause because German is verb-final ("Ich werde … aufzeichnen"): the
 *  subject can sit several tokens ahead of the verb. */
const SUBJECT_WINDOW = 8;
/** Tighter window for negation ("I never record") — a negation only flips the
 *  meaning when it's close to the verb. */
const NEGATION_LOOKBACK = 5;

/** Normalize to lowercase content tokens: fold accents, drop apostrophes
 *  (so "i'm" → "im"), split on any non-letter/digit. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics (ü→u, é→e)
    .replace(/['’`]/g, '') // "i'm" → "im", "won't" → "wont"
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Indices of recording-term tokens in a token list, including German
 *  separable verbs ("nehme … auf") resolved to the particle's position. */
function recordingHits(tokens: string[], cfg: LangConfig): number[] {
  const hits: number[] = [];
  const particles = cfg.separableParticles;
  const hasParticle = particles !== undefined && tokens.some((tk) => particles.has(tk));
  tokens.forEach((tk, i) => {
    if (cfg.recordingTerms.has(tk)) {
      hits.push(i);
    } else if (hasParticle && cfg.separableStems?.has(tk)) {
      hits.push(i);
    }
  });
  return hits;
}

/** True when the recording term at `idx` is a genuine first-person disclosure
 *  with no negation nearby. The subject test finds the CLOSEST subject before
 *  the verb: first-person wins, a nearer third/second-person subject
 *  ("they record", "did you record") disqualifies. */
function isFirstPersonDisclosure(tokens: string[], idx: number, cfg: LangConfig): boolean {
  if (hasNegationBefore(tokens, idx, cfg)) return false;
  const verb = tokens[idx];
  // Inherently first-person conjugations (e.g. Spanish "grabo") carry their own
  // subject — no separate marker needed.
  if (verb !== undefined && cfg.firstPersonTerms.has(verb)) return true;
  const start = Math.max(0, idx - SUBJECT_WINDOW);
  for (let j = idx - 1; j >= start; j--) {
    const tk = tokens[j];
    if (tk === undefined) continue;
    if (cfg.firstPersonMarkers.has(tk)) return true; // nearest subject is first-person
    if (cfg.thirdPersonMarkers.has(tk)) return false; // nearest subject is someone else
  }
  return false; // no subject found at all — not a disclosure
}

function hasNegationBefore(tokens: string[], idx: number, cfg: LangConfig): boolean {
  const start = Math.max(0, idx - NEGATION_LOOKBACK);
  for (let j = start; j < idx; j++) {
    const tk = tokens[j];
    if (tk !== undefined && cfg.negations.has(tk)) return true;
  }
  // A negation immediately AFTER (e.g. "record nothing", "record but I asked
  // her not to") within a couple tokens also disqualifies.
  for (let j = idx + 1; j <= Math.min(tokens.length - 1, idx + 3); j++) {
    const tk = tokens[j];
    if (tk !== undefined && cfg.negations.has(tk)) return true;
  }
  return false;
}

function scoreConfidence(tokens: string[], cfg: LangConfig, hasConsentPunct: boolean): number {
  let score = 0.5;
  if (tokens.some((tk) => cfg.purposeTokens.has(tk))) score += 0.25;
  const consent =
    hasConsentPunct || tokens.some((tk) => cfg.consentTokens.has(tk));
  if (consent) score += 0.25;
  return Math.min(1.0, score);
}

/** Dice coefficient over content tokens (stopwords dropped). */
function contentOverlap(a: string[], b: string[], cfg: LangConfig): number {
  const setA = new Set(a.filter((tk) => !cfg.stopwords.has(tk)));
  const setB = new Set(b.filter((tk) => !cfg.stopwords.has(tk)));
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const tk of setA) if (setB.has(tk)) inter++;
  return (2 * inter) / (setA.size + setB.size);
}

const CUSTOM_OVERLAP_THRESHOLD = 0.55;

/**
 * Scan `segments` for a spoken recording notice. Returns the earliest
 * qualifying match (with its audio timestamp, snippet, and confidence), or
 * null if none is found.
 */
export function detectRecordingNotice(
  segments: NoticeSegmentInput[],
  opts: DetectOptions = {},
): NoticeMatch | null {
  const cfg = LANGS[opts.locale ?? 'en'];
  const windowMs = opts.windowMs;
  const customTokenSets = (opts.customPhrases ?? [])
    .map((p) => tokenize(p))
    .filter((t) => t.length > 0);

  let best: NoticeMatch | null = null;

  for (const segment of segments) {
    if (windowMs !== undefined && segment.startMs >= windowMs) continue;
    const raw = segment.text;
    if (!raw || !raw.trim()) continue;
    const tokens = tokenize(raw);
    if (tokens.length === 0) continue;
    const hasConsentPunct = /[?？]/.test(raw);

    let matched = false;
    let confidence = 0;

    // (1) semantic core
    for (const idx of recordingHits(tokens, cfg)) {
      if (isFirstPersonDisclosure(tokens, idx, cfg)) {
        matched = true;
        confidence = Math.max(confidence, scoreConfidence(tokens, cfg, hasConsentPunct));
      }
    }

    // (2) custom-phrase overlap — only a strong overlap counts, so unrelated
    // small talk never trips it.
    if (!matched && customTokenSets.length > 0) {
      for (const phrase of customTokenSets) {
        const overlap = contentOverlap(tokens, phrase, cfg);
        if (overlap >= CUSTOM_OVERLAP_THRESHOLD) {
          matched = true;
          confidence = Math.max(confidence, Math.min(1.0, 0.5 + overlap * 0.5));
        }
      }
    }

    if (matched) {
      // Earliest qualifying segment wins (segments arrive in time order, but
      // guard by startMs regardless).
      if (!best || segment.startMs < best.atMs) {
        best = { atMs: segment.startMs, snippet: raw.trim(), confidence };
      }
    }
  }

  return best;
}
