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
  /** Imperative-first-person bigram: an object pronoun that only proves first
   *  person when directly preceded by a "let" verb ("let me record", "lass
   *  mich aufnehmen"). Bare "me"/"let" alone must NOT count — "do you want me
   *  to record", "let John record" are not disclosures (codex-review R6). */
  imperativeLet?: ReadonlySet<string>;
  imperativeObject?: ReadonlySet<string>;
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
    // Only genuine first-person SUBJECTS — not auxiliaries. "we're"/"i'm" are
    // expanded to "we are"/"i am" in tokenize(), so the subject pronoun (we/i)
    // is what proves first person, never a nearby "were"/"going"/"want" that
    // could beat the real third-person subject ("they were recording").
    firstPersonMarkers: new Set(['i', 'im', 'ive', 'ill', 'id', 'we']),
    thirdPersonMarkers: new Set(['they', 'you', 'he', 'she', 'it', 'someone', 'somebody', 'people', 'everybody', 'nobody', 'who', 'court']),
    imperativeLet: new Set(['let']),
    imperativeObject: new Set(['me', 'us']),
    negations: new Set(['not', 'never', 'no', 'cannot', 'without', 'stop', 'stopped', 'asked']),
    purposeTokens: new Set(['note', 'notes', 'notetaking', 'notekeeping']),
    consentTokens: new Set(['everyone', 'alright', 'okay', 'ok', 'consent', 'agree', 'anyone', 'objection', 'all']),
    stopwords: new Set(['the', 'a', 'an', 'this', 'that', 'is', 'are', 'be', 'being', 'for', 'my', 'our', 'and', 'of', 'to', 'on', 'in', 'so', 'just', 'now', 'today', 'we', 'i', 'am']),
  },
  de: {
    recordingTerms: new Set(['aufnehmen', 'aufnahme', 'aufnehme', 'aufnimmt', 'aufzeichnen', 'aufzeichnung', 'aufgezeichnet', 'aufzeichne']),
    firstPersonTerms: new Set(),
    // Pure subjects only — "werde"/"werden" are ambiguous auxiliaries (werden =
    // "they/we will"), so they must not prove first person on their own; the
    // subject pronoun (ich/wir) does. German is verb-final, so SUBJECT_WINDOW
    // still reaches the pronoun ahead of the recording verb.
    firstPersonMarkers: new Set(['ich', 'wir']),
    thirdPersonMarkers: new Set(['sie', 'er', 'es', 'man', 'du', 'ihr', 'jemand', 'leute', 'wer']),
    imperativeLet: new Set(['lass', 'lasst', 'lassen']),
    imperativeObject: new Set(['mich', 'uns']),
    negations: new Set(['nicht', 'nie', 'niemals', 'kein', 'keine', 'ohne']),
    separableStems: new Set(['nehme', 'nimmt', 'nehmen', 'zeichne', 'zeichnen']),
    separableParticles: new Set(['auf']),
    purposeTokens: new Set(['notizen', 'notiz', 'protokoll', 'aufzeichnungen']),
    consentTokens: new Set(['alle', 'einverstanden', 'ordnung', 'okay', 'ok', 'zustimmung', 'jemand']),
    stopwords: new Set(['der', 'die', 'das', 'ein', 'eine', 'dieses', 'diese', 'ist', 'sind', 'fur', 'meine', 'mein', 'unsere', 'und', 'von', 'zu', 'auf', 'so', 'jetzt', 'heute', 'wir', 'ich']),
  },
  es: {
    recordingTerms: new Set(['grabar', 'grabando', 'grabacion', 'grabaciones', 'grabo', 'grabare', 'graba', 'graban', 'grabada', 'grabado', 'grabamos']),
    // Only true first-person conjugations. "grabando" is the gerund
    // ("recording"), NOT inherently first-person — "ellos están grabando" is
    // third person — so it's excluded here and must lean on a subject marker
    // ("estoy grabando").
    firstPersonTerms: new Set(['grabo', 'grabare', 'grabamos']),
    // No bare 'me' — Spanish "me" is an object pronoun ("¿me quieres grabar?"
    // = "do you want to record me?"), not a subject (codex-review R6). "let me"
    // is the single token "déjame"/"déjeme" (accents folded → dejame/dejeme).
    firstPersonMarkers: new Set(['estoy', 'voy', 'vamos', 'quiero', 'yo', 'dejame', 'dejeme', 'dejenme']),
    // No 'esta' here — it collides with the demonstrative "esta" ("this"). A
    // subjectless "está grabando" already fails (no first-person subject
    // found), and explicit third-person subjects (usted/ellos) are covered.
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

/** Contractions expanded to their subject + auxiliary/negation BEFORE
 *  apostrophes are stripped, so "we're recording" becomes "we are recording"
 *  (subject = "we"), and "won't" becomes "will not" (negation = "not"). This is
 *  what keeps an auxiliary from ever standing in for a subject: only the real
 *  pronoun proves first person, and the negation survives as its own token. */
const CONTRACTIONS: Array<[RegExp, string]> = [
  [/\bwon't\b/g, 'will not'],
  [/\bcan't\b/g, 'can not'],
  [/\bcannot\b/g, 'can not'],
  [/\bdon't\b/g, 'do not'],
  [/\bdoesn't\b/g, 'does not'],
  [/\bdidn't\b/g, 'did not'],
  [/\bisn't\b/g, 'is not'],
  [/\baren't\b/g, 'are not'],
  [/\bwasn't\b/g, 'was not'],
  [/\bweren't\b/g, 'were not'],
  [/\bhaven't\b/g, 'have not'],
  [/\bhasn't\b/g, 'has not'],
  [/\bi'm\b/g, 'i am'],
  [/\bi'll\b/g, 'i will'],
  [/\bi've\b/g, 'i have'],
  [/\bi'd\b/g, 'i would'],
  [/\bwe're\b/g, 'we are'],
  [/\bwe'll\b/g, 'we will'],
  [/\bwe've\b/g, 'we have'],
  [/\byou're\b/g, 'you are'],
  [/\byou'll\b/g, 'you will'],
  [/\bthey're\b/g, 'they are'],
  [/\blet's\b/g, 'let us'],
];

/** Normalize to lowercase content tokens: fold accents, expand contractions,
 *  drop remaining apostrophes, split on any non-letter/digit. */
function tokenize(text: string): string[] {
  let s = text.toLowerCase().replace(/[’`]/g, "'"); // normalize apostrophe variants first
  for (const [re, repl] of CONTRACTIONS) s = s.replace(re, repl);
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics (ü→u, é→e)
    .replace(/'/g, '') // any surviving apostrophe (possessives etc.)
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
    // "let me" / "lass mich": an object pronoun counts as first-person ONLY
    // when directly preceded by the "let" verb — never bare "me"/"let".
    if (cfg.imperativeObject?.has(tk) && j > 0 && cfg.imperativeLet?.has(tokens[j - 1] ?? '')) return true;
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
    // small talk never trips it. Crucially, a transcript that NEGATES the
    // expected phrase ("I'm not recording this…" vs a script of "I'm recording
    // this…") must NOT verify: reject when the segment carries a negation the
    // expected phrase does not (codex-review R3). Affirmative notices already
    // match via the semantic core above, so this branch only runs when there's
    // no affirmative first-person disclosure to begin with.
    if (!matched && customTokenSets.length > 0) {
      const segHasNegation = tokens.some((tk) => cfg.negations.has(tk));
      for (const phrase of customTokenSets) {
        const phraseHasNegation = phrase.some((tk) => cfg.negations.has(tk));
        if (segHasNegation && !phraseHasNegation) continue; // transcript negated the script
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
