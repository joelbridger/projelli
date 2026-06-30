/**
 * askHelpers — pure helper functions + data-contract types extracted from
 * Ask.tsx. No React, no side-effects; safe to import anywhere.
 */

import {
  citationBasename,
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
import { ClaudeProvider } from '@/platform/providers/ClaudeProvider';
import { OpenAIProvider } from '@/platform/providers/OpenAIProvider';
import { GeminiProvider } from '@/platform/providers/GeminiProvider';
import {
  resolveAvailableLocalGenerationProvider,
  resolveLocalGenerationProvider,
} from '@/platform/providers/resolveLocalProvider';
import { localLlmModelStatus } from '@/platform/utils/tauri-commands';
import { mailGetMessage } from '@/platform/utils/mail-commands';
import { KeychainService } from '@/platform/providers/KeychainService';
import { assertCloudGenerationAllowed, isLocalOnlyMode } from '@/platform/privacy/localOnlyGuard';
import { NO_AI_PROVIDER } from '@/platform/privacy/egress';
import { IS_DEMO } from '@/web-demo/demoModeFlag';
import { createDemoProvider } from '@/web-demo/demoAIProvider';
import type { Provider } from '@/platform/providers/Provider';
import type { ChatMessage } from '@/platform/types/ai';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import {
  cloudKeyPresenceFromValues,
  resolveCloudSettingsDefaults,
  resolvePreferredCloudProvider,
  type CloudProviderKeyValues,
  type CloudProviderKeyPresence,
} from '@/platform/providers/resolvePreferredCloudProvider';
import { getInvalidProviders, getVerifiedProviders } from '@/platform/providers/keyVerification';
import {
  PROFESSION_MODEL_STORAGE_KEY,
  PROFESSION_PROVIDER_STORAGE_KEY,
} from '@/platform/profile/professionModel';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Which slice of the user's data to search.
 * - 'this-matter'  search only within the active matter (same as today's default)
 * - 'all-matters'  cross-matter (same as today's no-active-matter default)
 * - 'email'        restrict to mail: sourceId / sourceType === 'mail' chunks
 * - 'documents'    restrict to non-mail chunks (files, PDFs, transcripts, etc.)
 */
export type AskScope = 'this-matter' | 'all-matters' | 'email' | 'documents';
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
  /** Whether the source was returned from the verified RAG store. */
  verified: boolean;
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
  /**
   * Connector-access: present when this source was recognized as the OUTPUT of
   * an external advisor tool (a RightCapital plan PDF, a Jump meeting note). It
   * drives the honest "exported from RightCapital" badge on the source card and
   * the stale-plan freshness warning. Absent on every ordinary source. See
   * `@/platform/rag/sourceProvenance`.
   */
  provenance?: RecognizedProvenance;
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
  isStreaming?: boolean;
  error?: string;
}

export interface RecentAskSession {
  chatId: string;
  label: string;
  dateLabel: string;
}

interface AskSessionLike {
  messages: ChatMessage[];
  workspaceRoot?: string;
}

export interface BoundAnswerCitations {
  answer: string;
  citations: AnswerCitation[];
  sources: WorkspaceSource[];
}

export interface ResolvedAskProvider {
  provider: Provider;
  providerId: 'anthropic' | 'openai' | 'google' | 'ollama' | 'keepance-local';
  model: string;
}

// NO_AI_PROVIDER's value is the literal 'none'; we spell it out here (rather than
// `typeof NO_AI_PROVIDER`, which is the wider `EgressProvider`/string and would
// collapse the whole union to `string`).
export type ActiveAskProviderId = ResolvedAskProvider['providerId'] | 'none';

export const NO_ASK_PROVIDER_CONNECTED_MESSAGE =
  'No AI provider is connected. Add an API key in Settings, or set up local AI.';

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
  if (s.sourceType === 'meeting') return `Calendly - ${citationBasename(s.path)}`;
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

/**
 * The local engine the Ask / Search surface should use when no cloud provider is
 * chosen: the embedded Advisor Prep Hero Local AI when it is downloaded and READY,
 * otherwise the user's own Ollama daemon. Delegates to the shared resolver so
 * every surface (Ask / Chat / Client Map / Glance / email / workflows) prefers
 * the same on-device engine — and so Local-only mode is honest about WHICH local
 * model runs (a fresh install with the embedded model ready must NOT fail with
 * "couldn't reach your AI provider" because Ollama isn't installed).
 */
export async function resolveLocalAskProvider(): Promise<ResolvedAskProvider> {
  return await resolveLocalGenerationProvider();
}

async function resolveAvailableLocalAskProvider(): Promise<ResolvedAskProvider | null> {
  return await resolveAvailableLocalGenerationProvider();
}

/**
 * The cloud provider (+ model) the Ask send would prefer for the given key
 * PRESENCE, honouring the user's SELECTED default provider/model and the
 * verified/invalid sets. Shared by buildResolvedAskProvider (the real send) and
 * resolveActiveAskProviderId (the pre-send display badge) so the two can never
 * disagree on WHICH cloud provider is chosen — e.g. keys for Anthropic+OpenAI
 * with default=OpenAI must resolve to OpenAI in BOTH.
 */
function resolveAskCloudResolution(availableKeys: CloudProviderKeyPresence) {
  const settings = useSettingsStore.getState();
  return resolvePreferredCloudProvider({
    availableKeys,
    settings: resolveCloudSettingsDefaults(
      settings.getSetting('defaultProvider'),
      settings.getSetting('defaultModel'),
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(PROFESSION_PROVIDER_STORAGE_KEY)
        : null,
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(PROFESSION_MODEL_STORAGE_KEY)
        : null,
    ),
    verifiedProviders: getVerifiedProviders(),
    invalidProviders: getInvalidProviders(),
  });
}

/**
 * The providerId the NEXT Ask / Search send will use — for DISPLAY only (the
 * pre-send egress badge). No provider construction and no confidentiality-gate
 * side effects, so it is safe to call from a render effect. Mirrors
 * buildResolvedAskProvider's destination decision so the badge never names a
 * different engine than the send will actually use:
 *   - Local-only mode     -> the local engine (embedded-when-ready, else Ollama);
 *   - else the cloud provider the send would pick (via resolveAskCloudResolution,
 *     honouring the user's selected default), when a key for it is present;
 *   - else (no cloud key) -> the local engine (embedded-when-ready, else Ollama).
 */
export async function resolveActiveAskProviderId(): Promise<ActiveAskProviderId> {
  const localId = async (): Promise<'keepance-local' | 'ollama'> => {
    try {
      if ((await localLlmModelStatus()) === 'ready') return 'keepance-local';
    } catch {
      // Desktop-only command unavailable or probe failed — fall back to Ollama.
    }
    return 'ollama';
  };
  if (isLocalOnlyMode()) return await localId();
  // Web demo: Ask routes through the demo provider (BYOK-direct or the shared
  // demo proxy), both of which forward to Claude — so the honest egress provider
  // is 'anthropic'. Without this, the demo has no OS-keychain key and the badge
  // would falsely read "No AI connected". The EgressIndicator's isDemo handling
  // turns 'anthropic' into the correct demo-proxy / BYOK-direct destination copy.
  if (IS_DEMO) return 'anthropic';
  // Read key PRESENCE read-only (hasKey, NOT getKey) — getKey stamps the key's
  // 'last used' metadata, an unwanted mutation from a display-only badge effect.
  const kc = new KeychainService();
  const availableKeys: CloudProviderKeyPresence = {
    anthropic: await kc.hasKey('anthropic'),
    openai: await kc.hasKey('openai'),
    google: await kc.hasKey('google'),
  };
  const resolved = resolveAskCloudResolution(availableKeys);
  if (resolved) return resolved.provider;
  const localProvider = await resolveAvailableLocalAskProvider();
  return localProvider?.providerId ?? NO_AI_PROVIDER;
}

export async function buildResolvedAskProvider(): Promise<ResolvedAskProvider> {
  // Local-only ENFORCEMENT (privacy): Ask has no per-chat provider — it picks by
  // key presence below — so in Local-only mode it would otherwise build a cloud
  // provider whenever a cloud key exists, contradicting the "nothing leaves"
  // indicator. Force the local model instead (embedded-when-ready, else Ollama),
  // so Ask honours Local-only.
  if (isLocalOnlyMode()) {
    return await resolveLocalAskProvider();
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
  // Same cloud-selection path the pre-send badge uses (resolveAskCloudResolution),
  // so the badge name and the actual send can never disagree.
  const resolved = resolveAskCloudResolution(cloudKeyPresenceFromValues(cloudKeys));

  if (resolved) {
    const apiKey = cloudKeys[resolved.provider];
    if (apiKey) {
      assertCloudGenerationAllowed();
      switch (resolved.provider) {
        case 'anthropic': {
          const provider = new ClaudeProvider({ apiKey, model: resolved.model });
          return {
            provider,
            providerId: 'anthropic',
            model: provider.getMetadata().model,
          };
        }
        case 'openai': {
          const provider = new OpenAIProvider({ apiKey, model: resolved.model });
          return {
            provider,
            providerId: 'openai',
            model: provider.getMetadata().model,
          };
        }
        case 'google': {
          const provider = new GeminiProvider({ apiKey, model: resolved.model });
          return {
            provider,
            providerId: 'google',
            model: provider.getMetadata().model,
          };
        }
      }
    }
  }
  // No usable cloud provider (no key, or no explicit choice yet). In Direct /
  // Assured mode, only claim a local route after proving one exists: embedded
  // Advisor Prep Hero Local AI ready, else a reachable Ollama daemon.
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

  // Genuine auth — the ONLY branch that mentions a key. Never in Local-only
  // (there is no key to check there), and never when the AI was not even reached
  // (reachedProvider === false => the failure was in the file-search stage, so an
  // auth-shaped string there must not be blamed on a key).
  if (
    !localOnly &&
    opts?.reachedProvider !== false &&
    (lower.includes('401') ||
      lower.includes('unauthorized') ||
      lower.includes('invalid_api_key') ||
      lower.includes('authentication'))
  ) {
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

/** Build conversation history block for system prompt (last N turns). */
export function buildHistoryBlock(turns: AskTurn[], maxTurns = 6): string {
  if (turns.length === 0) return '';
  const recent = turns.slice(-maxTurns);
  const lines: string[] = ['Conversation so far (last exchanges):'];
  for (const t of recent) {
    lines.push(`Q: ${t.question}`);
    lines.push(`A: ${t.answer}`);
  }
  lines.push('\nNow answer the new question below, citing sources with [filename paragraph N] as before.');
  return lines.join('\n');
}

function dateLabelFromTimestamp(ts: string | undefined): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  } catch {
    return '';
  }
}

export function sessionBelongsToWorkspace(
  session: { workspaceRoot?: string; messages?: unknown[] },
  workspaceRoot: string | null | undefined,
): boolean {
  if (!workspaceRoot) return true;
  return session.workspaceRoot === workspaceRoot;
}

export function buildRecentAskSessions(
  sessions: Record<string, AskSessionLike>,
  workspaceRoot: string | null | undefined,
  options: {
    prefix?: string;
    excludeChatId?: string;
    limit?: number;
  } = {},
): RecentAskSession[] {
  const prefix = options.prefix ?? 'ask-';
  const limit = options.limit ?? 5;

  return Object.entries(sessions)
    .filter(([key, session]) =>
      key.startsWith(prefix) &&
      key !== options.excludeChatId &&
      sessionBelongsToWorkspace(session, workspaceRoot) &&
      session.messages.some((m) => m.role === 'user'),
    )
    .sort(([, a], [, b]) => {
      const aTs = a.messages.find((m) => m.role === 'user')?.timestamp ?? '';
      const bTs = b.messages.find((m) => m.role === 'user')?.timestamp ?? '';
      return bTs.localeCompare(aTs);
    })
    .map(([key, session]) => {
      const firstUserMsg = session.messages.find((m) => m.role === 'user');
      return {
        chatId: key,
        label: firstUserMsg?.content ?? key,
        dateLabel: dateLabelFromTimestamp(firstUserMsg?.timestamp),
      };
    })
    .slice(0, limit);
}

export function buildWorkspaceSources(hits: RagHit[]): WorkspaceSource[] {
  return hits.map((h) => ({
    path: h.path,
    chunkText: h.chunkText,
    score: h.score,
    paragraphIndex: h.paragraphIndex,
    ...(h.sourceType !== undefined ? { sourceType: h.sourceType } : {}),
    ...(h.pageNumber !== undefined ? { pageNumber: h.pageNumber } : {}),
    ...(h.extraction !== undefined ? { extraction: h.extraction } : {}),
    ...(h.extractionConfidence !== undefined ? { extractionConfidence: h.extractionConfidence } : {}),
    ...(h.locator !== undefined ? { locator: h.locator } : {}),
    ...(h.id !== undefined ? { id: h.id } : {}),
    ...(h.matterId !== undefined ? { matterId: h.matterId } : {}),
  }));
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
  return (
    sources.find((s) =>
      s.path === hit.path &&
      (s.paragraphIndex === hit.paragraphIndex || s.pageNumber === hit.pageNumber),
    ) ??
    sources.find((s) => s.path === hit.path && s.paragraphIndex === hit.paragraphIndex)
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

function citationFromHit(
  hit: RagHit,
  n: number,
  sources: WorkspaceSource[],
  expectedMatterId: string | null,
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
    verified: inExpectedMatter,
    paragraphIndex: hit.paragraphIndex,
    ...(hit.id !== undefined ? { id: hit.id } : {}),
    ...(hit.matterId !== undefined ? { matterId: hit.matterId } : {}),
    ...(provenance ? { provenance } : {}),
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
 * block binder ({@link bindAnswerBlocks} in answerBlocks.ts) calls the core once
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
      acc.citations.push(citationFromHit(matchedHit, n, sources, expectedMatterId));
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
        acc.citations.push(citationFromHit(matchedHit, n, sources, expectedMatterId));
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
  const acc = newCitationBindAccumulator();
  const answer = bindCitationsCore(answerText, hits, expectedMatterId, acc);
  acc.citations.sort((a, b) => a.n - b.n);
  return { answer, citations: acc.citations, sources: buildWorkspaceSources(hits) };
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
          return { ...c, verified: provenExact };
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
          // time — a persisted files block keeps its green "From your files"
          // label ONLY if it has citations and EVERY one still re-grounds to a
          // verified source. Zero survivors, or any unverified/out-of-matter
          // citation, downgrades it to general (strip every leftover marker).
          if (blockCitations.length > 0 && blockCitations.every((c) => c.verified)) {
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

/** Returns true for a hit that came from imported email. */
export function isMailHit(hit: RagHit): boolean {
  return hit.sourceType === 'mail' || hit.path.startsWith('mail:') || (hit.sourceId?.startsWith('mail:') ?? false);
}

/**
 * Filter retrieved hits according to the user-selected scope.
 * 'this-matter' and 'all-matters' keep all hits (retrieval scope is already
 * correct from the Tauri-level query). 'email' keeps only mail: chunks;
 * 'documents' keeps only non-mail chunks.
 */
export function filterHitsByScope(hits: RagHit[], scope: AskScope): RagHit[] {
  if (scope === 'email') return hits.filter(isMailHit);
  if (scope === 'documents') return hits.filter((h) => !isMailHit(h));
  return hits;
}
