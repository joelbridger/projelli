/**
 * askHelpers — pure helper functions + data-contract types extracted from
 * Ask.tsx. No React, no side-effects; safe to import anywhere.
 */

import {
  citationBasename,
  normalizeNumericCitations,
  parseCitations,
  resolveCitationPath,
} from '@/platform/rag/workspaceCommand';
import {
  recognizeProvenance,
  provenanceDedupeKey,
  type RecognizedProvenance,
} from '@/platform/rag/sourceProvenance';
import type { WorkspaceSource } from '@/platform/types/ai';
import type { RagHit } from '@/platform/utils/tauri-commands';
import type { DateConflictFlag, DatedFact, SourceDate } from '@/platform/retrieval/dates';
import { buildDatedWorkspaceSources, prepareDatedRagHits } from '@/platform/retrieval/dates';
import { createProvider } from '@/platform/providers/providerFactory';
import { resolveAvailableLocalGenerationProvider } from '@/platform/providers/resolveLocalProvider';
import { mailGetMessage } from '@/platform/utils/mail-commands';
import { KeychainService } from '@/platform/providers/KeychainService';
import { assertCloudGenerationAllowed, isLocalOnlyMode } from '@/platform/privacy/localOnlyGuard';
import { LOCAL_AI_NAME } from '@/config/brandText';
import {
  type ConsentScope,
} from '@/platform/ai/fileAccessConsent';
import { IS_DEMO } from '@/web-demo/demoModeFlag';
import { createDemoProvider } from '@/web-demo/demoAIProvider';
import type { Provider } from '@/platform/providers/Provider';
import type { ChatMessage } from '@/platform/types/ai';
import {
  cloudKeyPresenceFromValues,
  type CloudProviderKeyValues,
} from '@/platform/providers/resolvePreferredCloudProvider';
import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import {
  resolveActiveCloudResolution,
  resolveActiveEgressProviderId,
  type ActiveEgressProviderId,
} from '@/platform/privacy/activeEgressProvider';
import type { AuditSourceIdentity } from '@/platform/types/audit';
import type { EgressDestination } from '@/platform/privacy/egress';

export {
  askConsentScope,
  composerIsBusy,
  defaultAskScope,
  filterHitsByScope,
  isMailHit,
  normalizeVisibleAskScope,
} from './askScope';
export type { AskScope } from './askScope';
export {
  buildHistoryBlock,
  buildRecentAskSessions,
  deriveTurnGrounding,
  selectHistoryTurns,
  sessionBelongsToWorkspace,
  turnIsFileDerived,
} from './askHistory';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type AskFailureStage =
  | 'setup'
  | 'retrieval'
  | 'post-retrieval'
  | 'provider-resolution'
  | 'provider-send'
  | 'post-processing';

export interface AnswerCitation {
  /** 1-based chip number as it appears in the answer text {n}. */
  n: number;
  /** Human-readable label (basename + locator/section). */
  label: string;
  /** Raw passage text from the retrieved chunk. */
  excerpt: string;
  /** Full workspace-relative path; null if resolution failed. */
  path: string | null;
  /** Locator string for the source (page, section, etc.). */
  locator: string;
  /**
   * Honest "verified" badge (B1). TRUE only when the MODEL explicitly cited
   * this source (a citation marker that resolved to a retrieved chunk) AND the
   * chunk is in the expected client scope. A post-hoc fuzzy match — our own
   * guess that an answer sentence resembles a retrieved chunk — is NOT proof
   * the chunk supports the claim, so it is `verified: false` (shown "source
   * found, not verified"). Never set true purely because a chunk is in the
   * right client.
   */
  verified: boolean;
  /**
   * Whether this citation resolves to a REAL retrieved chunk within the
   * expected client scope (B1). True for both explicit and post-hoc citations
   * that are in-scope; false for cross-client matches. Distinct from
   * `verified`: `grounded` keeps an honest "source found" chip present (so the
   * citation is never removed), while `verified` gates the stronger green
   * badge. Absent on pre-B1 persisted citations — callers fall back to
   * `verified` for those.
   */
  grounded?: boolean;
  /**
   * WS3: paragraph index for the chunk — passed to `onOpenFileAtPath` so
   * the editor can scroll directly to the cited passage on chip click.
   * Absent on pre-3.0 citations (undefined = use paragraph 0).
   */
  paragraphIndex?: number;
  /**
   * WS3: content-addressed chunk id — passed to `ragVerifyCitation` for
   * on-demand source verification. Absent on pre-3.0 citations.
   */
  id?: string;
  /**
   * WS3: the matter this chunk belongs to — the confidentiality scope
   * used as `claimedMatterId` in `ragVerifyCitation`. Absent on pre-3.0
   * citations.
   */
  matterId?: string;
  /** Source kind / file extension, when known. Drives source-card file icons. */
  sourceType?: string;
  /**
   * Connector-access: present when this source was recognized as the OUTPUT of
   * an external advisor tool (a RightCapital plan PDF, a Jump meeting note). It
   * drives the honest "exported from RightCapital" badge on the source card and
   * the stale-plan freshness warning. Absent on every ordinary source. See
   * `@/platform/rag/sourceProvenance`.
   */
  provenance?: RecognizedProvenance;
  /** B1: source-time metadata from the retrieved hit, when safely known. */
  sourceDate?: SourceDate;
  /** B1: the source's explicit dated claim, including visible authority context. */
  datedFact?: DatedFact;
  /** B1: incompatible dated evidence supplied by retrieval; never inferred by the UI. */
  dateConflict?: DateConflictFlag;
}

/**
 * Source-aware advisor agent (Ask-smart): which kind of evidence a contiguous
 * run of the answer is built from. Stored as REAL data (not inferred from
 * colour) so labels are reliable, exports are honest, and the audit log can
 * later prove what was grounded and what wasn't.
 *
 *   - 'files'         claims drawn from the user's own documents/email; every
 *                     sentence carries a citation that can be checked.
 *   - 'general'       the model's own knowledge — concepts, how-things-work.
 *                     Never cited (there is nothing to cite); carries a quiet
 *                     "rules change, verify current figures" line.
 *   - 'draft'         something written for the user (an email, a one-pager,
 *                     talking points). Labelled "draft, review before sending".
 *   - 'nothing-found' the honest absence: searched the files, found nothing on
 *                     this. Leads the answer so generic guidance below can never
 *                     read as if it were the client's actual records.
 */
export type AnswerBlockKind = 'files' | 'general' | 'draft' | 'nothing-found';

/**
 * One labelled, provenance-tagged section of an answer. The single most
 * important trust rule the block model enforces: a cited file-claim and an
 * uncited general claim NEVER share a block, so a green "from your files" badge
 * can never sit over an uncited sentence.
 */
export interface AnswerBlock {
  kind: AnswerBlockKind;
  /**
   * Block prose. For 'files' blocks the {n} citation markers are already
   * substituted; for every other kind the text is verbatim with any stray
   * citation markers stripped (defence — a general/draft block must never carry
   * a chip).
   */
  text: string;
  /** Citations bound within THIS block ('files' blocks only; [] otherwise). */
  citations: AnswerCitation[];
}

export interface AskTurn {
  question: string;
  answer: string;
  citations: AnswerCitation[];
  sources: WorkspaceSource[];
  /**
   * Ask-smart: the provenance-labelled blocks the answer is built from. Present
   * on smart-mode answers (the source-aware agent); absent on files-only,
   * demo, and legacy/persisted turns, which render via the flat path. When
   * present, the renderer shows per-block labels + a per-answer tally instead of
   * the single green/uncited attestation.
   */
  blocks?: AnswerBlock[];
  /**
   * F2.5b (Codex P1) — DURABLE marker that this answer was produced with client
   * file content actually sent to the model (retrieval grounded it), set at
   * creation from the consent-gated grounding set. It does NOT depend on whether
   * a citation survived post-hoc grounding, so a grounded-but-uncited answer is
   * still recognized as file-derived. Used to redact such turns from the history
   * block on a later denied/wrong-scope cloud send (see useAsk). Absent on
   * legacy/reconstructed turns → the citations/sources/blocks heuristic backs it up.
   */
  groundedFromFiles?: boolean;
  /**
   * F2.5b (Codex round 3) — the consent scope this turn's file content was
   * retrieved under (a single client, or all clients). Set at creation from the
   * turn's retrieval scope when it was file-grounded. History redaction re-sends a
   * prior file-grounded answer to a cloud provider ONLY when the CURRENT consent
   * covers this scope — so an all-clients answer (or one grounded on a local turn)
   * can never ride into a cloud send that holds only a single-client grant.
   */
  groundingScope?: ConsentScope;
  /** B6 — local source identities actually included in this answer's prompt. */
  readSources?: AuditSourceIdentity[];
  /** Provider used for this answer, captured at answer time for proof lines. */
  providerId?: string;
  /** Where this answer was actually sent, captured at answer time for proof lines. */
  egressDestination?: EgressDestination;
  /** True only for built-in canned sample answers; missing provider is not enough. */
  isDemoAnswer?: boolean;
  isStreaming?: boolean;
  error?: string;
}

export interface RecentAskSession {
  chatId: string;
  label: string;
  dateLabel: string;
}

export interface BoundAnswerCitations {
  answer: string;
  citations: AnswerCitation[];
  sources: WorkspaceSource[];
}

export interface ResolvedAskProvider {
  provider: Provider;
  providerId: 'anthropic' | 'openai' | 'google' | 'ollama' | 'lantern-local';
  model: string;
}

// NO_AI_PROVIDER's value is the literal 'none'; we spell it out here (rather than
// `typeof NO_AI_PROVIDER`, which is the wider `EgressProvider`/string and would
// collapse the whole union to `string`).
export type ActiveAskProviderId = ResolvedAskProvider['providerId'] | 'none';

export const NO_ASK_PROVIDER_CONNECTED_MESSAGE =
  'No AI provider is connected. Add an API key in Settings, or set up local AI.';

/**
 * Ask searches local files before it resolves the answering model. When that
 * model is remote, an unanswered (or newly out-of-scope) file-access prompt
 * must stop the send. Otherwise the cloud model receives only the typed
 * question and produces a plausible but uncited answer even though retrieval
 * found real evidence locally (BUG-01).
 */
export const CLOUD_FILE_ACCESS_REQUIRED_MESSAGE =
  'Allow AI file access, then ask again. Your question is still here.';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

export function sourceLocator(s: WorkspaceSource): string {
  if (s.sourceType === 'transcript' && s.locator) return `Tr. ${s.locator}`;
  if (s.pageNumber != null) {
    const base = citationBasename(s.path);
    if (s.sourceType === 'pdf') return `${base} p. ${String(s.pageNumber)}`;
    if (s.sourceType === 'xlsx') return `${base} sheet ${String(s.pageNumber)}`;
    if (s.sourceType === 'pptx') return `${base} slide ${String(s.pageNumber)}`;
  }
  if (s.sourceType === 'onedrive') return `OneDrive - ${citationBasename(s.path)}`;
  if (s.sourceType === 'esign') return `DocuSign - ${citationBasename(s.path)}`;
  if (s.sourceType === 'meeting') {
    const label = s.path.startsWith('calendar:') ? 'Calendar' : 'Calendly';
    return `${label} - ${citationBasename(s.path)}`;
  }
  if (s.sourceType === 'box') return `Box - ${citationBasename(s.path)}`;
  if (s.sourceType === 'jotform') return `Jotform - ${citationBasename(s.path)}`;
  if (s.sourceType === 'sharefile') return `ShareFile - ${citationBasename(s.path)}`;
  if (s.sourceType === 'zocks') return `Zocks - ${citationBasename(s.path)}`;
  if (s.sourceType === 'addepar') return `Addepar - ${citationBasename(s.path)}`;
  return `${citationBasename(s.path)} §${String(s.paragraphIndex)}`;
}

/**
 * Returns true when the user has at least one valid cloud API key
 * (Anthropic, OpenAI, or Google). Ollama is not considered a cloud key.
 * This mirrors the priority order in buildProviderAsync but returns a boolean
 * through the keychain service so desktop reads the OS keychain and browser
 * mode reads localStorage.
 */
export async function hasCloudKey(): Promise<boolean> {
  const kc = new KeychainService();
  const anthropicKey = await kc.getKey('anthropic');
  if (anthropicKey?.trim()) return true;
  const openaiKey = await kc.getKey('openai');
  if (openaiKey?.trim()) return true;
  const googleKey = await kc.getKey('google');
  if (googleKey?.trim()) return true;
  return false;
}

async function resolveAvailableLocalAskProvider(): Promise<ResolvedAskProvider | null> {
  return await resolveAvailableLocalGenerationProvider();
}

/**
 * Honest, actionable failure shown when Local-only mode has no usable local
 * engine yet — never surfaced generically; `friendlyErrorMessage` passes this
 * exact string through unchanged (same pattern as NO_ASK_PROVIDER_CONNECTED_MESSAGE).
 */
export const LOCAL_AI_NOT_READY_MESSAGE =
  `${LOCAL_AI_NAME} is still downloading or setting up. Check its progress in Settings, then try again.`;

/**
 * The local engine Local-only mode actually sends to: the embedded Advisor Prep
 * Hero Local AI when it is downloaded and READY, otherwise the user's own Ollama
 * daemon — but ONLY if Ollama is PROVABLY REACHABLE right now (see
 * `resolveAvailableLocalGenerationProvider`). This is the fix for the demo's
 * #2 failure mode: a fresh install with the embedded model still downloading
 * and no Ollama installed must fail with an honest "still setting up" message
 * up front, never silently construct an OllamaProvider that is guaranteed to
 * fail deep inside the send with a confusing "Ollama unreachable" error.
 */
export async function resolveLocalOnlyAskProvider(): Promise<ResolvedAskProvider> {
  const local = await resolveAvailableLocalAskProvider();
  if (local) return local;
  throw new Error(LOCAL_AI_NOT_READY_MESSAGE);
}

/**
 * The providerId the NEXT Ask / Search send will use — for DISPLAY only (the
 * pre-send egress badge). No provider construction and no confidentiality-gate
 * side effects, so it is safe to call from a render effect.
 *
 * F1: this now delegates to THE single source of truth
 * (`resolveActiveEgressProviderId` in activeEgressProvider.ts) — the SAME
 * function the top-bar TrustBar resolves through — so the pre-send badge and the
 * top bar can never disagree on one screen. That resolver mirrors
 * buildResolvedAskProvider's destination decision, so the badge never names a
 * different engine than the send will actually use.
 */
export async function resolveActiveAskProviderId(): Promise<ActiveEgressProviderId> {
  return resolveActiveEgressProviderId(getConfidentialityMode());
}

export async function buildResolvedAskProvider(): Promise<ResolvedAskProvider> {
  // Local-only ENFORCEMENT (privacy): Ask has no per-chat provider — it picks by
  // key presence below — so in Local-only mode it would otherwise build a cloud
  // provider whenever a cloud key exists, contradicting the "nothing leaves"
  // indicator. Force the local model instead (embedded-when-ready, else Ollama
  // ONLY if it's provably reachable — see resolveLocalOnlyAskProvider), so Ask
  // honours Local-only without ever silently routing to an engine that isn't
  // actually there.
  if (isLocalOnlyMode()) {
    return await resolveLocalOnlyAskProvider();
  }
  // Web demo (browser): there is no OS keychain and no on-device engine, so the
  // cloud/local resolution below would throw NO_ASK_PROVIDER_CONNECTED. Route Ask
  // through the demo provider instead — `createDemoProvider` returns a direct
  // ClaudeProvider when the user has pasted a personal (BYOK) key, otherwise the
  // shared, rate-limited demo proxy (POSTs to /api/demo-chat). Both forward to
  // Claude, so the honest providerId is 'anthropic'. The demo banner + egress
  // indicator disclose the shared-relay path; no confidentiality-choice gate is
  // applied because the demo is not a personal install.
  if (IS_DEMO) {
    return buildDemoAskProvider();
  }
  // Personal-install choice gate (Task 1.3): a personal install must never reach a
  // cloud provider for generation before the user has made an explicit confidentiality
  // choice. Gate ONLY on the cloud branches, after confirming a cloud key exists, so a
  // personal install with no cloud key still falls back to local Ollama (no egress).
  // Retrieval (MemoryService) runs BEFORE this function and is unaffected. Firm installs
  // are a no-op (the gate checks isFirm first and passes through).
  const kc = new KeychainService();
  const cloudKeys: CloudProviderKeyValues = {
    anthropic: (await kc.getKey('anthropic'))?.trim(),
    openai: (await kc.getKey('openai'))?.trim(),
    google: (await kc.getKey('google'))?.trim(),
  };
  // Same cloud-selection path the pre-send badge uses (resolveActiveCloudResolution
  // in activeEgressProvider.ts), so the badge name and the actual send can never
  // disagree.
  const resolved = resolveActiveCloudResolution(cloudKeyPresenceFromValues(cloudKeys));

  if (resolved) {
    const apiKey = cloudKeys[resolved.provider];
    if (apiKey) {
      assertCloudGenerationAllowed();
      // One front door: build through the shared factory so this surface can
      // never drift from the redline / chat / Client Map on which provider a
      // given selection maps to (fix F2.2). resolved.provider is cloud-only
      // here; the factory throws on an unknown id rather than defaulting.
      const provider = createProvider({ provider: resolved.provider, apiKey, model: resolved.model });
      return { provider, providerId: resolved.provider, model: provider.getMetadata().model };
    }
  }
  // No usable cloud provider (no key, or no explicit choice yet). In Direct /
  // Assured mode, only claim a local route after proving one exists: embedded
  // Lantern Local AI ready, else a reachable Ollama daemon.
  const localProvider = await resolveAvailableLocalAskProvider();
  if (localProvider) return localProvider;
  throw new Error(NO_ASK_PROVIDER_CONNECTED_MESSAGE);
}

export async function buildProviderAsync(): Promise<Provider> {
  return (await buildResolvedAskProvider()).provider;
}

/**
 * Resolve the Ask provider for the browser web-demo. `createDemoProvider` picks
 * BYOK-direct (a pasted key) vs the shared demo proxy internally; either way the
 * underlying model is Claude, so the providerId is 'anthropic' for honest egress
 * labelling. Synchronous — the demo provider needs no keychain reads. Only ever
 * called when `IS_DEMO` is true.
 */
function buildDemoAskProvider(): ResolvedAskProvider {
  const provider = createDemoProvider();
  return { provider, providerId: 'anthropic', model: provider.getMetadata().model };
}

/**
 * Maps raw provider error messages to plain-language user-facing text.
 *
 * UX-29: the message must be mode- and stage-aware. The catch-all used to say
 * "check your key" for ANY unmatched error — even when the provider returned
 * 200 OK (the real cause was the local search index) and even in Local-only
 * mode where there is no key. Now:
 *   - "key" is mentioned ONLY for a genuine auth (401) error, and never in
 *     Local-only mode;
 *   - a failure before the AI was reached is named as a search/index issue;
 *   - Local-only failures reassure the user nothing left their machine;
 *   - every fallback offers "search by keyword instead".
 *
 * @param raw   The raw provider/error string.
 * @param opts  mode: the confidentiality mode; reachedProvider: whether the
 *              provider call actually started (false => the failure was in the
 *              file-search/index stage, not the AI/key).
 */
/**
 * True when `raw` looks like a genuine provider auth rejection (401/403 —
 * bad, disabled, revoked, or permission-denied key) rather than a rate
 * limit, context-length, or search/index failure. Shared by
 * {@link friendlyErrorMessage} (which turns this into the "key was rejected"
 * copy) and useAsk's send-failure handler (which uses the SAME check to
 * decide whether to call `markKeyInvalid` on the resolved provider), so the
 * displayed message and the key-status marker can never disagree.
 *
 * Never true in Local-only mode (there is no key to check there), and never
 * when the AI was not even reached (`reachedProvider === false` means the
 * failure was in the file-search stage, so an auth-shaped string there must
 * not be blamed on a key).
 */
export function isAuthRejectionError(
  raw: string,
  opts?: { mode?: string; reachedProvider?: boolean },
): boolean {
  const lower = raw.toLowerCase();
  const localOnly = opts?.mode === 'local-only';
  return (
    !localOnly &&
    opts?.reachedProvider !== false &&
    (lower.includes('401') ||
      lower.includes('403') ||
      lower.includes('unauthorized') ||
      lower.includes('forbidden') ||
      lower.includes('invalid_api_key') ||
      lower.includes('authentication'))
  );
}

/* eslint-disable lantern-i18n/no-hardcoded-string */
export function friendlyErrorMessage(
  raw: string,
  opts?: { mode?: string; reachedProvider?: boolean; failedStage?: AskFailureStage },
): string {
  const lower = raw.toLowerCase();
  const localOnly = opts?.mode === 'local-only';

  if (raw === NO_ASK_PROVIDER_CONNECTED_MESSAGE) {
    return NO_ASK_PROVIDER_CONNECTED_MESSAGE;
  }
  if (raw === LOCAL_AI_NOT_READY_MESSAGE) {
    return LOCAL_AI_NOT_READY_MESSAGE;
  }
  if (raw === CLOUD_FILE_ACCESS_REQUIRED_MESSAGE) {
    return CLOUD_FILE_ACCESS_REQUIRED_MESSAGE;
  }

  // Genuine auth — the ONLY branch that mentions a key.
  if (isAuthRejectionError(raw, opts)) {
    return 'Your AI key was rejected. Check it in Settings.';
  }
  if (
    lower.includes('429') ||
    lower.includes('quota') ||
    lower.includes('rate') ||
    lower.includes('overloaded')
  ) {
    return localOnly
      ? 'Your local AI is busy right now. Wait a moment and try again.'
      : 'Your AI provider is over its usage limit right now. Wait a moment and try again.';
  }
  if (
    lower.includes('context_length') ||
    lower.includes('too large') ||
    lower.includes('maximum context')
  ) {
    return 'That question is too long for this model. Try a shorter one.';
  }

  if (
    lower.includes('private file search is only available in the desktop app') ||
    lower.includes('rag is only available in the desktop app')
  ) {
    return 'Private file search is only available in the desktop app. In this browser preview, use the sample questions or open the desktop app to search your files.';
  }

  // The AI was never reached: the failure was in searching your files, not the
  // AI or a key. (Covers the "provider returned 200 but the local index wasn't
  // ready" case, where retrieval throws before the provider call.)
  if (
    opts?.failedStage === 'retrieval' ||
    (opts?.failedStage === undefined && opts?.reachedProvider === false)
  ) {
    return "I couldn't search your files yet. Your private search may still be setting up. Try again in a moment, or search by keyword instead.";
  }

  // Generic AI failure (the provider was reached, or stage is unknown).
  return localOnly
    ? "The local AI couldn't answer, and your data stayed on your machine. Make sure your private AI finished setting up, then try again. You can also search by keyword instead."
    : "I couldn't get an answer from your AI. Try again in a moment, or search by keyword instead.";
}
/* eslint-enable lantern-i18n/no-hardcoded-string */

export function buildWorkspaceSources(hits: RagHit[]): WorkspaceSource[] {
  return buildDatedWorkspaceSources(hits);
}

const POST_HOC_STOP_WORDS = new Set([
  'a',
  'about',
  'above',
  'after',
  'again',
  'all',
  'also',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'down',
  'during',
  'each',
  'few',
  'for',
  'from',
  'had',
  'has',
  'have',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'him',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'itself',
  'just',
  'me',
  'more',
  'most',
  'my',
  'no',
  'not',
  'of',
  'on',
  'once',
  'only',
  'or',
  'other',
  'our',
  'out',
  'over',
  'own',
  'same',
  'she',
  'should',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'will',
  'with',
  'would',
  'you',
  'your',
]);

interface ClaimSpan {
  start: number;
  end: number;
  text: string;
}

interface GroundingScore {
  hit: RagHit;
  score: number;
}

function normalizeForGrounding(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}.%$]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function tokenSet(text: string): Set<string> {
  const tokens = normalizeForGrounding(text).match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
  return new Set(
    tokens
      .map((t) => t.replace(/^'+|'+$/g, ''))
      .filter((t) => t.length >= 3 && !POST_HOC_STOP_WORDS.has(t)),
  );
}

function numericTokens(text: string): Set<string> {
  const matches = text.match(/(?:\$|€|£)?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  return new Set(matches.map((m) => m.replace(/[$€£,]/g, '').toLowerCase()));
}

function splitClaimSpans(answerText: string): ClaimSpan[] {
  const spans: ClaimSpan[] = [];
  const sentenceRe = /[^.!?\n]+(?:[.!?]+|$)/g;
  let match: RegExpExecArray | null;
  while ((match = sentenceRe.exec(answerText)) !== null) {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const start = match.index + leading;
    const end = match.index + raw.length - trailing;
    const text = answerText.slice(start, end).trim();
    if (text.length > 0) spans.push({ start, end, text });
  }
  return spans;
}

function isGroundableClaim(text: string): boolean {
  const normalized = normalizeForGrounding(text);
  if (!normalized) return false;
  if (normalized.includes("couldn't find") || normalized.includes('could not find')) return false;
  if (normalized.includes('not contain the answer')) return false;
  if (normalized.includes('outside this sample')) return false;
  const words = tokenSet(text);
  const numbers = numericTokens(text);
  return numbers.size > 0 || words.size >= 4;
}

function scoreClaimAgainstHit(claim: string, hit: RagHit): GroundingScore | null {
  const claimNorm = normalizeForGrounding(claim);
  const hitNorm = normalizeForGrounding(hit.chunkText);
  if (!claimNorm || !hitNorm) return null;

  const claimNumbers = numericTokens(claim);
  const hitNumbers = numericTokens(hit.chunkText);
  const allNumbersSupported = [...claimNumbers].every((n) => hitNumbers.has(n));
  if (!allNumbersSupported) return null;

  const claimWords = tokenSet(claim);
  const hitWords = tokenSet(hit.chunkText);
  const overlap = [...claimWords].filter((w) => hitWords.has(w)).length;
  const ratio = claimWords.size === 0 ? 0 : overlap / claimWords.size;

  if (hitNorm.includes(claimNorm) && claimWords.size >= 3) {
    return { hit, score: 1 + ratio };
  }

  if (claimNumbers.size > 0) {
    if (overlap >= 2 || ratio >= 0.35) {
      return { hit, score: 0.8 + ratio + claimNumbers.size * 0.1 };
    }
    return null;
  }

  if (overlap >= 5 && ratio >= 0.55) {
    return { hit, score: ratio };
  }

  return null;
}

function bestPostHocGrounding(claim: string, hits: RagHit[]): RagHit | null {
  let best: GroundingScore | null = null;
  for (const h of hits) {
    const scored = scoreClaimAgainstHit(claim, h);
    if (!scored) continue;
    if (!best || scored.score > best.score || (scored.score === best.score && h.score > best.hit.score)) {
      best = scored;
    }
  }
  return best?.hit ?? null;
}

function citationKey(hit: RagHit): string {
  return hit.id ?? `${hit.path}:${String(hit.paragraphIndex)}:${String(hit.pageNumber ?? '')}`;
}

function findSourceForHit(sources: WorkspaceSource[], hit: RagHit): WorkspaceSource | undefined {
  // B2: pageNumber is undefined for every non-PDF chunk. Comparing
  // `s.pageNumber === hit.pageNumber` then evaluates `undefined === undefined`
  // → true, so a citation for paragraph 8 would wrongly match the FIRST source
  // from the same file (its locator points at the wrong chunk). Only treat a
  // page match as a match when BOTH page numbers are real; otherwise the chunk
  // must agree on the exact paragraph index.
  const samePage = (s: WorkspaceSource): boolean =>
    typeof s.pageNumber === 'number' &&
    typeof hit.pageNumber === 'number' &&
    s.pageNumber === hit.pageNumber;
  return (
    // Prefer the EXACT paragraph chunk first (Codex P2). A page-numbered
    // non-PDF source — a transcript, xlsx sheet, or pptx slide — can hold
    // several paragraph chunks that share ONE pageNumber; matching on page
    // first would return an earlier chunk on the same page and mislabel the
    // locator. Exact paragraph is the precise chunk for every source type.
    sources.find((s) => s.path === hit.path && s.paragraphIndex === hit.paragraphIndex) ??
    // Then fall back to a REAL page match (both page numbers present), the
    // page-level locator when no exact paragraph chunk is in the source list.
    sources.find((s) => s.path === hit.path && samePage(s))
  );
}

/**
 * Connector-access: recognize whether a RAG hit is the OUTPUT of an external
 * advisor tool (a RightCapital plan, a Jump meeting note). Pure adapter from a
 * `RagHit` to the recognizer's input — uses the display path (falling back to
 * the resolvable source id) for the filename signal and the chunk text for the
 * branding/structure signal. Returns null for the ordinary majority of sources.
 */
export function recognizeHit(hit: RagHit): RecognizedProvenance | null {
  return recognizeProvenance({
    path: hit.path || hit.sourceId,
    text: hit.chunkText,
    sourceType: hit.sourceType,
  });
}

/**
 * Connector-access: collapse a TRULY duplicate export chunk that arrived through
 * two paths — e.g. the exact same plan PDF synced into two watched folders — so
 * it is never used as evidence twice in one answer.
 *
 * Critically, this must NOT collapse different pages/sections of one report
 * (that would silently drop later-page evidence). So the dedupe key is
 * chunk-level: the artifact key (tool + kind + date + matter) PLUS BOTH the
 * page number AND the paragraph index AND a hash of the chunk's FULL text. Two
 * hits collapse only when they are the same artifact, the same exact location,
 * AND byte-identical content — i.e. genuinely the same chunk via two arrival
 * paths. Two different chunks on one page that merely share a long boilerplate
 * header have different full text, so they survive (a 200-char prefix would have
 * wrongly merged them). Distinct chunks, undated artifacts, and all ordinary
 * sources pass through untouched. Keeps the FIRST occurrence (= relevance order).
 */
export function dedupeRecognizedHits(hits: RagHit[]): RagHit[] {
  const seen = new Set<string>();
  const out: RagHit[] = [];
  for (const hit of hits) {
    const prov = recognizeHit(hit);
    const artifactKey = prov ? provenanceDedupeKey(prov, hit.matterId) : null;
    if (artifactKey !== null) {
      const normalized = hit.chunkText.replace(/\s+/g, ' ').trim();
      // page AND paragraph (PDF uses pageNumber, text uses paragraphIndex; keep
      // both so a same-page/different-paragraph chunk is never merged), plus a
      // full-text hash + length so only byte-identical chunks ever collapse.
      const chunkKey =
        `${artifactKey}|p${String(hit.pageNumber ?? '')}|g${String(hit.paragraphIndex)}` +
        `|${hashText(normalized)}:${String(normalized.length)}`;
      if (seen.has(chunkKey)) continue;
      seen.add(chunkKey);
    }
    out.push(hit);
  }
  return out;
}

/** Tiny, dependency-free 32-bit string hash (djb2) for dedupe fingerprints.
 *  Not cryptographic — only needs to distinguish distinct chunk text. */
function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * How a citation was bound to its chunk (B1):
 *   - 'explicit'  the model emitted a citation marker that resolved to a
 *                 retrieved chunk — the model itself pointed at this source.
 *   - 'post-hoc'  WE fuzzy-matched an answer sentence to a chunk after the
 *                 fact. It's a plausible source, not proof the chunk supports
 *                 the claim — never badged "verified".
 */
type CitationGrounding = 'explicit' | 'post-hoc';

function citationFromHit(
  hit: RagHit,
  n: number,
  sources: WorkspaceSource[],
  expectedMatterId: string | null,
  grounding: CitationGrounding,
): AnswerCitation {
  const matchedSource = findSourceForHit(sources, hit);
  const inExpectedMatter =
    expectedMatterId === null ||
    hit.matterId === undefined ||
    hit.matterId === expectedMatterId;
  const provenance = recognizeHit(hit);

  return {
    n,
    label: citationBasename(hit.path),
    excerpt: hit.chunkText,
    path: hit.path,
    locator: matchedSource ? sourceLocator(matchedSource) : citationBasename(hit.path),
    // B1: "verified" (green) requires an EXPLICIT model citation in scope. A
    // post-hoc fuzzy match is grounded but unverified — shown "source found,
    // not verified" rather than a green badge it hasn't earned.
    verified: inExpectedMatter && grounding === 'explicit',
    // "grounded" keeps the chip present for any in-scope match (explicit OR
    // post-hoc) so honest citations are never silently dropped; a cross-client
    // match is neither grounded nor verified.
    grounded: inExpectedMatter,
    paragraphIndex: hit.paragraphIndex,
    ...(hit.sourceType !== undefined ? { sourceType: hit.sourceType } : {}),
    ...(hit.id !== undefined ? { id: hit.id } : {}),
    ...(hit.matterId !== undefined ? { matterId: hit.matterId } : {}),
    ...(provenance ? { provenance } : {}),
    ...(hit.sourceDate !== undefined ? { sourceDate: hit.sourceDate } : {}),
    ...(hit.datedFact !== undefined ? { datedFact: hit.datedFact } : {}),
    ...(hit.dateConflict !== undefined ? { dateConflict: hit.dateConflict } : {}),
  };
}

/**
 * Resolve each email citation's raw `mail:<id>` label to the message SUBJECT for
 * display (the Verified source panel + citation chips). Display-only: the `path`
 * (`mail:<id>`) is left untouched, so citation verification and navigation are
 * unaffected. Desktop-only (mailGetMessage); off-desktop or on any failure the
 * original label is kept. One lookup per distinct message id serves repeats.
 */
export async function resolveEmailCitationLabels(
  citations: AnswerCitation[],
): Promise<AnswerCitation[]> {
  const ids = [
    ...new Set(
      citations
        .map((c) => c.path)
        .filter((p): p is string => !!p && p.startsWith('mail:'))
        .map((p) => p.slice('mail:'.length)),
    ),
  ];
  if (ids.length === 0) return citations;

  const subjectById = new Map<string, string>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const subject = (await mailGetMessage(id)).subject.trim();
        if (subject) subjectById.set(id, subject);
      } catch {
        // Desktop-only / message not found — keep the raw label.
      }
    }),
  );
  if (subjectById.size === 0) return citations;

  return citations.map((c) => {
    if (!c.path?.startsWith('mail:')) return c;
    const subject = subjectById.get(c.path.slice('mail:'.length));
    return subject ? { ...c, label: subject } : c;
  });
}

/**
 * Attach answer citations only when the model's marker points at a real
 * retrieved source. A newer RAG row can also carry id + matterId for backend
 * verification, but older rows are still grounded when the cited file and
 * locator were actually retrieved.
 *
 * If the model emits no usable markers, do a conservative post-hoc pass: compare
 * each answer sentence against the retrieved chunks and add chips only for
 * claims whose numbers and distinctive words are supported by a chunk. This
 * keeps the Ask promise truthful without depending on a model following the
 * citation-marker instruction exactly.
 */
/**
 * Mutable accumulator threaded through one or more {@link bindCitationsCore}
 * calls so citation NUMBERING and DEDUP are global across spans. The Ask-smart
 * block binder ({@link bindAnswerBlocks} in answerBlockHelpers.ts) calls the core once
 * per FILES block sharing a single accumulator, so a source reused across blocks
 * keeps one chip number and the Sources panel stays 1..N for the whole answer.
 */
export interface CitationBindAccumulator {
  citationMap: Map<string, number>;
  citations: AnswerCitation[];
  chipCounter: number;
}

export function newCitationBindAccumulator(): CitationBindAccumulator {
  return { citationMap: new Map<string, number>(), citations: [], chipCounter: 0 };
}

/**
 * Bind citations within ONE span of answer text against the retrieved hits,
 * accumulating into a shared {@link CitationBindAccumulator}. Returns the span's
 * rewritten text with `{n}` markers substituted. Does NOT sort `acc.citations`
 * — the caller sorts once after the final span.
 *
 * The post-hoc grounding fallback fires only when THIS span produced no
 * marker-based citation (so an unmarked FILES block still earns chips), keyed on
 * the accumulator's per-span delta — identical to the whole-answer behaviour
 * when called once via {@link bindAnswerCitations}.
 */
export function bindCitationsCore(
  answerText: string,
  hits: RagHit[],
  expectedMatterId: string | null,
  acc: CitationBindAccumulator,
): string {
  const parsed = parseCitations(answerText);
  const sources = buildWorkspaceSources(hits);
  const decisions: { start: number; end: number; n: number | null }[] = [];

  for (const cite of [...parsed].sort((a, b) => a.start - b.start)) {
    const resolvedPath = resolveCitationPath(cite, hits);
    const matchedHit = resolvedPath === null
      ? undefined
      : hits.find(
          (h) =>
            h.path === resolvedPath &&
            (h.paragraphIndex === cite.paragraphIndex || h.pageNumber === cite.paragraphIndex),
        );

    if (!matchedHit) {
      decisions.push({ start: cite.start, end: cite.end, n: null });
      continue;
    }

    const key = matchedHit.id ?? `${matchedHit.path}:${String(matchedHit.paragraphIndex)}:${String(matchedHit.pageNumber ?? '')}`;
    let n: number;
    if (acc.citationMap.has(key)) {
      n = acc.citationMap.get(key) ?? acc.chipCounter;
    } else {
      acc.chipCounter += 1;
      n = acc.chipCounter;
      acc.citationMap.set(key, n);
      // Explicit: the model emitted this citation marker and it resolved to a
      // retrieved chunk — eligible for the green "verified" badge when in scope.
      acc.citations.push(citationFromHit(matchedHit, n, sources, expectedMatterId, 'explicit'));
    }
    decisions.push({ start: cite.start, end: cite.end, n });
  }

  let rewritten = answerText;
  for (const d of [...decisions].sort((a, b) => b.start - a.start)) {
    if (d.n === null) {
      let start = d.start;
      if (start > 0 && rewritten[start - 1] === ' ') start -= 1;
      rewritten = rewritten.slice(0, start) + rewritten.slice(d.end);
    } else {
      rewritten = rewritten.slice(0, d.start) + `{${String(d.n)}}` + rewritten.slice(d.end);
    }
  }

  // Post-hoc grounding fires only when THIS span produced no MARKER-based
  // citation. Keyed on "did any parsed marker resolve" (not on whether a NEW
  // citation object was appended) — otherwise a later block whose only marker
  // REUSES an earlier block's already-numbered source would still trigger the
  // fallback and double-chip an already-cited sentence (Codex P2).
  const anyMarkerResolved = decisions.some((d) => d.n !== null);
  if (!anyMarkerResolved && hits.length > 0) {
    const insertions: { at: number; n: number }[] = [];
    for (const span of splitClaimSpans(rewritten)) {
      if (!isGroundableClaim(span.text)) continue;
      const matchedHit = bestPostHocGrounding(span.text, hits);
      if (!matchedHit) continue;

      const key = citationKey(matchedHit);
      let n: number;
      if (acc.citationMap.has(key)) {
        n = acc.citationMap.get(key) ?? acc.chipCounter;
      } else {
        acc.chipCounter += 1;
        n = acc.chipCounter;
        acc.citationMap.set(key, n);
        // Post-hoc: WE matched this chunk to the sentence after the fact. Keep
        // the chip (grounded) but never badge it "verified" — it's a guess, not
        // a model citation (B1).
        acc.citations.push(citationFromHit(matchedHit, n, sources, expectedMatterId, 'post-hoc'));
      }
      insertions.push({ at: span.end, n });
    }

    for (const insertion of [...insertions].sort((a, b) => b.at - a.at)) {
      rewritten = `${rewritten.slice(0, insertion.at)} {${String(insertion.n)}}${rewritten.slice(insertion.at)}`;
    }
  }

  return rewritten;
}

export function bindAnswerCitations(
  answerText: string,
  hits: RagHit[],
  expectedMatterId: string | null = null,
): BoundAnswerCitations {
  // Date conflict detection must happen before citations are bound. The
  // renderer receives citations, rather than raw retrieval hits, so doing it
  // only while building the saved source list would drop this context from the
  // live Ask answer.
  const datedHits = prepareDatedRagHits(hits);
  const acc = newCitationBindAccumulator();
  // F-503: repair a small local model's number-keyed citations (`[1]`) to the
  // `[<filename> paragraph N]` form so they bind. Safe here because files-only
  // mode treats the ENTIRE answer as a files answer (no general/draft blocks
  // whose bracketed numeric text must be preserved). No-op for filename
  // citations and when nothing was retrieved.
  const answer = bindCitationsCore(
    normalizeNumericCitations(answerText, datedHits),
    datedHits,
    expectedMatterId,
    acc,
  );
  acc.citations.sort((a, b) => a.n - b.n);
  return { answer, citations: acc.citations, sources: buildWorkspaceSources(datedHits) };
}

/**
 * Renumber an answer's surviving citations to a contiguous 1..N and rewrite the
 * `{n}` markers in every FILES block to match. Used after a block downgrade may
 * have dropped some citations (at bind time and on reload) so the Sources panel
 * never starts at 2 or shows a gap — the global 1..N numbering contract holds
 * (Codex P2). Only FILES blocks carry markers; other kinds pass through. The
 * incoming `citations` must be the SURVIVING set (those still referenced by a
 * files block); they are sorted by their current number to assign the new order.
 */
export function renumberBlocksAndCitations(
  blocks: AnswerBlock[],
  citations: AnswerCitation[],
): { blocks: AnswerBlock[]; citations: AnswerCitation[] } {
  const sorted = [...citations].sort((a, b) => a.n - b.n);
  const remap = new Map<number, number>();
  sorted.forEach((c, i) => remap.set(c.n, i + 1));
  const renumberText = (t: string): string =>
    t.replace(/\{(\d+)\}/g, (m, nStr: string) => {
      const nn = remap.get(Number.parseInt(nStr, 10));
      return nn !== undefined ? `{${String(nn)}}` : m;
    });
  const newBlocks = blocks.map((b) =>
    b.kind === 'files'
      ? {
          ...b,
          text: renumberText(b.text),
          citations: b.citations.map((c) => ({ ...c, n: remap.get(c.n) ?? c.n })),
        }
      : b,
  );
  const newCitations = sorted.map((c) => ({ ...c, n: remap.get(c.n) ?? c.n }));
  return { blocks: newBlocks, citations: newCitations };
}

/**
 * TRUST BOUNDARY (review P1): split a trailing run of UNCITED general prose off
 * an otherwise-cited files block. Smart mode lets the model add general guidance,
 * so a malformed answer can put a general sentence INSIDE a files block — e.g.
 * "Their income put them above the limit [tax.pdf p2]. Generally, the pro-rata
 * rule counts pre-tax money toward a conversion." The second sentence is general
 * knowledge, not a file claim, and must not sit under a green "From your files"
 * label. We split AFTER the last citation marker: the cited head stays a files
 * block (its chips preserved), and a trailing groundable claim is demoted to a
 * general block. Splitting only the TRAILING run (the common malformation —
 * cite the facts, then tack on general explanation) avoids false-positives on a
 * shared-citation cluster like "A is X. B is Y {1}." where the single citation
 * legitimately covers both sentences and nothing groundable follows it.
 */
export function splitTrailingGeneralFromFilesBlock(
  text: string,
  citations: AnswerCitation[],
): AnswerBlock[] {
  const whole: AnswerBlock[] = [{ kind: 'files', text: text.trim(), citations }];
  const markers = [...text.matchAll(/\{\d+\}/g)];
  const last = markers[markers.length - 1];
  if (!last) return whole;

  // The cited content extends to the END OF THE SENTENCE the last citation is
  // part of — NOT just to the marker. A mid-sentence citation ("According to the
  // plan {1}, the target is 60. Generally, …") must keep its whole sentence under
  // the files label, and demote only the SEPARATE general sentence that follows.
  const mEnd = last.index + last[0].length;
  const before = text.slice(0, last.index);
  // A terminator immediately before the marker means the marker is a trailing
  // attribution of an already-finished sentence ("…retire at 60. {1} Generally…")
  // — the cited sentence ends AT the marker. Otherwise the cited sentence ends at
  // the next real sentence terminator AFTER the marker.
  const markerIsPostPeriod = /[.!?][\p{Pe}\p{Pf}"'\s]*$/u.test(before);
  let cutPoint: number;
  if (markerIsPostPeriod) {
    cutPoint = mEnd;
  } else {
    const rel = nextSentenceTerminator(text.slice(mEnd));
    if (rel === null) return whole; // marker's sentence is the last sentence — no tail
    cutPoint = mEnd + rel + 1;
  }

  let head = text.slice(0, cutPoint);
  let tail = text.slice(cutPoint);
  // Absorb leading terminators / closing brackets / quotes / whitespace into the
  // head so the general tail never starts with stray punctuation.
  const lead = /^[\s.!?\p{Pe}\p{Pf}"']+/u.exec(tail);
  if (lead) {
    head += lead[0];
    tail = tail.slice(lead[0].length);
  }
  const tailText = tail.replace(/\{\d+\}/g, '').trim();
  if (!tailText) return whole;

  // Over-demote is the safe direction for this trust boundary, so demote the
  // trailing run if it contains ANY sentence that is not recognised filler —
  // including SHORT substantive claims like "Taxable." or "Not taxable." that a
  // word-count rule would wrongly let stay under the green files label (review
  // #2). Only an explicit acknowledgment/connective allowlist is exempt.
  const hasTrailingClaim = splitClaimSpans(tailText).some((s) => {
    const norm = s.text
      .replace(/\{\d+\}/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return norm.length > 0 && !TRAILING_FILLER.has(norm);
  });
  if (!hasTrailingClaim) return whole;

  return [
    { kind: 'files', text: head.trim(), citations },
    { kind: 'general', text: tailText, citations: [] },
  ];
}

/**
 * Acknowledgment / connective phrases that may legitimately trail a cited
 * sentence without being a substantive claim, so they don't force a files block
 * to split. Anything NOT in this set is treated as a claim and demoted (the safe,
 * over-demote direction). Normalised to lowercase alphanumerics + single spaces.
 */
const TRAILING_FILLER = new Set([
  'ok', 'okay', 'got it', 'thanks', 'thank you', 'done', 'noted', 'understood',
  'sure', 'agreed', 'right', 'exactly', 'yes', 'no', 'yep', 'nope', 'correct',
  'indeed', 'of course', 'fyi', 'na', 'thats it', 'thats all', 'thats key',
  'heres why', 'see below', 'more below', 'the end', 'let me know',
]);

/**
 * Index of the next sentence-ending `.!?` in `s`, skipping a `.` that sits
 * between two digits (a decimal like "$1.5M", so the boundary isn't taken
 * mid-number). Returns null when there is no sentence terminator. Used to find
 * where a cited sentence ends so trailing general prose can be split off.
 */
function nextSentenceTerminator(s: string): number | null {
  const re = /[.!?]/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const i = m.index;
    if (s[i] === '.' && i > 0 && /\d/.test(s[i - 1] ?? '') && /\d/.test(s[i + 1] ?? '')) continue;
    return i;
  }
  return null;
}

/** Reconstruct AskTurn[] from persisted ChatMessage pairs (user+assistant). */
export function reconstructTurns(messages: ChatMessage[]): AskTurn[] {
  const turns: AskTurn[] = [];
  let i = 0;
  // Fix #3: iterate i < messages.length (not length - 1) so a trailing lone
  // user message (e.g. crash mid-stream) is not silently dropped.
  while (i < messages.length) {
    const userMsg = messages[i];
    const assistantMsg = messages[i + 1];
    if (userMsg && assistantMsg && userMsg.role === 'user' && assistantMsg.role === 'assistant') {
      // BUG-016: a turn saved BEFORE the grounding fix may carry ungrounded
      // citations. Two bad classes exist: (1) a fabricated source with
      // path:null / verified:false; and (2) the subtler one — the old binder
      // resolved a fabricated claim to a REAL file by basename and saved it as
      // verified:true with a real path but a paragraph/page that was never
      // retrieved. We must NOT trust the persisted `verified` flag. Instead
      // re-ground each citation against the turn's own persisted sources: keep
      // it only when a saved source exists at the exact cited locator (path AND
      // paragraphIndex OR pageNumber). Anything else is dropped and its marker
      // stripped, so no stale bad answer can re-render a fake chip/source title
      // or trip the green attestation on reload.
      const restoredSources = assistantMsg.askSources ?? [];
      // F2.5b (Codex P1) — restore the durable "this answer used client file
      // content" marker so history redaction survives a reload even for a
      // grounded-but-uncited turn (added to every reconstructed pair below).
      // F2.5b (Codex round 3/5) — restore the persisted grounding marker (flag +
      // scope) for scope-aware history redaction. A DEFINITE `true`/`false` came
      // from the current code (the false case proves an answer is general and
      // safe to keep); an ABSENT marker is a LEGACY turn — leave `groundedFromFiles`
      // undefined so `turnIsFileDerived` fails closed on it.
      const groundedMarker: Pick<AskTurn, 'groundedFromFiles' | 'groundingScope'> | Record<string, never> =
        assistantMsg.askGroundedFromFiles === true
          ? {
              groundedFromFiles: true,
              ...(assistantMsg.askGroundingScope ? { groundingScope: assistantMsg.askGroundingScope } : {}),
            }
          : assistantMsg.askGroundedFromFiles === false
            ? { groundedFromFiles: false }
            : {};
      const receiptMarker: Pick<AskTurn, 'readSources' | 'providerId' | 'egressDestination' | 'isDemoAnswer'> = {};
      if (assistantMsg.askReadSources && assistantMsg.askReadSources.length > 0) {
        receiptMarker.readSources = assistantMsg.askReadSources;
      }
      if (assistantMsg.askProviderId) {
        receiptMarker.providerId = assistantMsg.askProviderId;
      }
      if (assistantMsg.askEgressDestination) {
        receiptMarker.egressDestination = assistantMsg.askEgressDestination;
      }
      if (assistantMsg.askIsDemoAnswer) {
        receiptMarker.isDemoAnswer = true;
      }
      const groundedCitations = (assistantMsg.askCitations ?? [])
        .filter((c) => {
          if (c.path == null) return false;
          return restoredSources.some((s) => {
            if (s.path !== c.path) return false;
            // Pre-WS3 citations have no locator — keep by path only (the saved
            // source still proves the file was retrieved), but they can't be
            // "proven" so they're shown UNVERIFIED below.
            if (c.paragraphIndex === undefined) return true;
            // Locator present: it must match a saved source's paragraph OR page,
            // so a stale "real file + fabricated paragraph" citation is dropped.
            return s.paragraphIndex === c.paragraphIndex || s.pageNumber === c.paragraphIndex;
          });
        })
        // BUG-065: do NOT trust the persisted `verified` flag on reload. A
        // restored citation is "source found" (green) ONLY when its EXACT
        // locator still matches a saved source; a path-only (pre-WS3) citation
        // is kept but rendered UNVERIFIED (red) since the exact passage is
        // unprovable. (Backend re-verification on load is a separate follow-up.)
        .map((c) => {
          const provenExact =
            c.paragraphIndex !== undefined &&
            restoredSources.some(
              (s) => s.path === c.path && (s.paragraphIndex === c.paragraphIndex || s.pageNumber === c.paragraphIndex),
            );
          // B1: reconstruct can't re-check client scope on reload, so the
          // persisted flags carry it. A restored citation is `grounded` (kept +
          // shown "source found") only when its EXACT locator re-grounds AND it
          // was in-scope when saved — `grounded` if present, else the legacy
          // `verified` flag as the in-scope proxy (a cross-client citation was
          // persisted verified:false, so it stays NOT grounded and its block
          // still downgrades). It re-earns the green `verified` badge only when
          // it also re-grounds AND was explicitly verified when saved — never
          // re-promote a persisted post-hoc/unverified citation to green.
          const inScopeWhenSaved = c.grounded ?? c.verified;
          return {
            ...c,
            grounded: provenExact && inScopeWhenSaved,
            verified: provenExact && c.verified,
          };
        });

      // Ask-smart: restore the provenance blocks when this assistant message was
      // produced by the source-aware agent. Re-ground the persisted citations
      // (above) and re-attach the survivors to their block by the {n} markers in
      // each block's text. Handles BOTH cited and uncited smart turns (a turn may
      // be all general/nothing-found with zero citations and still needs its
      // labels restored), so it runs ahead of the flat cited/uncited branches.
      const persistedBlocks = assistantMsg.askBlocks;
      if (persistedBlocks && persistedBlocks.length > 0) {
        // The ORIGINAL persisted verified flag captured the matter-scope check at
        // answer time. reconstructTurns can't re-check matter scope on reload, and
        // BUG-065 deliberately recomputes `verified` from exact-locator match for
        // the flat path — which would FLIP a persisted cross-matter (verified:
        // false) citation to green. For the BLOCK path's green/downgrade decision
        // we keep a citation "verified" only if it BOTH re-grounds AND was not
        // persisted as unverified, so a cross-matter citation can never come back
        // green after reload (Codex P1).
        const originalVerified = new Map<number, boolean>();
        // A legacy citation missing the flag is recovered downstream by `?? true`.
        for (const c of assistantMsg.askCitations ?? []) originalVerified.set(c.n, c.verified);
        const keepN = new Set(groundedCitations.map((c) => c.n));
        const blocks: AnswerBlock[] = persistedBlocks.flatMap((pb): AnswerBlock[] => {
          if (pb.kind !== 'files') {
            return [{ kind: pb.kind, text: pb.text.replace(/\s*\{\d+\}/g, '').trim(), citations: [] }];
          }
          // Files block: keep only survivor markers, drop the rest.
          const stripped = pb.text.replace(/\s*\{(\d+)\}/g, (mk, nStr: string) =>
            keepN.has(Number.parseInt(nStr, 10)) ? mk : '',
          );
          const present = new Set<number>();
          for (const mm of stripped.matchAll(/\{(\d+)\}/g)) {
            present.add(Number.parseInt(mm[1] ?? '0', 10));
          }
          const blockCitations = groundedCitations
            .filter((c) => present.has(c.n))
            // AND the re-grounded verification with the original persisted flag.
            .map((c) => ({ ...c, verified: c.verified && (originalVerified.get(c.n) ?? true) }));
          // TRUST BOUNDARY (Codex P1): same downgrade rule on reload as at bind
          // time — a persisted files block keeps its "From your files" label
          // ONLY if it has citations and EVERY one still re-grounds to a chunk
          // IN SCOPE. B1: gate on `grounded` (re-grounded + in-scope), not
          // `verified`, so an honest post-hoc "source found, not verified" chip
          // stays in its files block on reload instead of being scrubbed; a
          // cross-client citation is not grounded and still downgrades the block.
          if (blockCitations.length > 0 && blockCitations.every((c) => c.grounded)) {
            // Same trailing-general split as at bind time (review P1).
            return splitTrailingGeneralFromFilesBlock(stripped.trim(), blockCitations);
          }
          return [{ kind: 'general', text: stripped.replace(/\s*\{\d+\}/g, '').trim(), citations: [] }];
        });
        // Turn-level citations reflect only what survived in a (still-)files
        // block; renumber to a contiguous 1..N so a downgrade can't leave a gap.
        const kept = new Set<number>();
        for (const b of blocks) if (b.kind === 'files') for (const c of b.citations) kept.add(c.n);
        const survivingCitations = groundedCitations.filter((c) => kept.has(c.n));
        const renum = renumberBlocksAndCitations(blocks, survivingCitations);
        turns.push({
          question: userMsg.content,
          answer: renum.blocks.map((b) => b.text).join('\n\n').trim(),
          citations: renum.citations,
          sources: restoredSources,
          blocks: renum.blocks,
          ...groundedMarker,
          ...receiptMarker,
        });
        i += 2;
        continue;
      }

      if (groundedCitations.length > 0) {
        const keep = new Set(groundedCitations.map((c) => c.n));
        // Strip markers for any dropped citation; keep survivors' markers intact.
        const answer = assistantMsg.content.replace(/\s*\{(\d+)\}/g, (m, nStr: string) =>
          keep.has(Number.parseInt(nStr, 10)) ? m : '',
        );
        turns.push({
          question: userMsg.content,
          answer,
          citations: groundedCitations,
          sources: restoredSources,
          ...groundedMarker,
          ...receiptMarker,
        });
      } else {
        // No grounded citations (legacy messages with none persisted, OR a
        // pre-fix turn whose citations were all ungrounded). Strip every {n}
        // marker so raw tokens don't appear in plain-text restored prose, and
        // restore as an uncited answer.
        turns.push({
          question: userMsg.content,
          answer: assistantMsg.content.replace(/\s*\{\d+\}/g, ''),
          citations: [],
          sources: [],
          ...groundedMarker,
          ...receiptMarker,
        });
      }
      i += 2;
    } else if (userMsg && userMsg.role === 'user' && (!assistantMsg || assistantMsg.role !== 'assistant')) {
      // Trailing lone user message (orphaned, no matching assistant reply).
      // Render as a pending turn with an empty answer instead of dropping it.
      turns.push({
        question: userMsg.content,
        answer: '',
        citations: [],
        sources: [],
      });
      i += 1;
    } else {
      i += 1;
    }
  }
  return turns;
}
