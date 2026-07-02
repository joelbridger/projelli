/**
 * Per-conversation consent for the AI's file tools with cloud models (F2.5).
 *
 * WHY THIS EXISTS — "reading is sending" when the model is remote. A cloud
 * provider (Anthropic / OpenAI / Gemini) sees every file the AI reads, lists, or
 * searches. Without a consent gate, a poisoned client document could steer the
 * cloud AI into silently pulling MORE client files and shipping them to the
 * vendor. So for CLOUD providers, the AI's file tools are OFF until the advisor
 * grants access for the conversation. Local engines (Ollama / Advisor Prep Hero
 * Local AI) run on the user's own machine and don't register tools at all, so
 * they're unaffected.
 *
 * SCOPE OF THE GATE (hardened after Codex security review):
 *  - The emphasis is READ-class tools (`read_file` / `list_files` /
 *    `search_files`) — the silent-exfiltration surface. But the WRITE-class
 *    tools (`write_file` / `create_folder` / `move_file` / `delete_file`) double
 *    as an existence oracle (e.g. `create_folder` reveals whether a guessed path
 *    already exists, silently, before any approval — and in all-clients scope
 *    that probe is workspace-wide). Leaving them registered while reads are
 *    withheld would let a poisoned model learn about client files anyway. So the
 *    consent gate registers ALL file tools together: consented → all on;
 *    unconsented → none. WRITE-class tools keep their existing per-action
 *    approval gate ([[aiWriteApproval]]) ON TOP, unchanged, whenever they run.
 *
 * A grant is BOUND to the scope it was made under (Codex review): an all-clients
 * grant covers any turn; a single-client grant covers ONLY that same client.
 * Switching the active client, or moving to all-clients, re-asks — a grant for
 * one client never silently widens to another client or to the whole practice.
 *
 * This module is PURE (no React, no store, no async) so the security-critical
 * decision is unit-testable in isolation. The store holds the state; the send
 * path and the composer banner consume these functions.
 */

/** The consent lifecycle for one conversation. */
export type FileAccessState = 'unasked' | 'granted' | 'denied';

/**
 * The scope a send runs under — and the scope a grant is bound to. A
 * single-client turn carries the concrete `matterId` so a grant can be tied to
 * exactly that client; all-clients has no id.
 */
export type ConsentScope =
  | { kind: 'matter'; matterId: string }
  | { kind: 'allMatters' };

export interface FileAccessConsent {
  state: FileAccessState;
  /** The scope this conversation was granted access under. Only meaningful when
   *  `state === 'granted'`; absent otherwise. */
  grantedScope?: ConsentScope;
}

/** The default for a conversation nobody has answered the prompt for yet. */
export const UNASKED_CONSENT: FileAccessConsent = { state: 'unasked' };

/** READ-class tools — the silent-read/exfiltration surface consent governs. */
export const READ_CLASS_TOOL_NAMES = ['read_file', 'list_files', 'search_files'] as const;

/** WRITE-class tools — gated by consent for registration AND by their own
 *  per-action approval when they run. */
export const WRITE_CLASS_TOOL_NAMES = ['write_file', 'create_folder', 'move_file', 'delete_file'] as const;

/** True for a READ-class tool (kept for documentation / defense-in-depth). */
export function isReadClassTool(name: string): boolean {
  return (READ_CLASS_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * The security-critical decision: may the AI's file tools run for a cloud send
 * in this conversation, under this scope?
 *
 * Fails CLOSED. A grant is bound to the scope it was made under:
 *  - all-clients grant → covers any turn (single-client or all-clients);
 *  - single-client grant → covers ONLY the SAME client (same `matterId`).
 *
 * So anything other than an explicit, scope-matching grant is `false`: unasked,
 * denied, missing, a different client, or a single-client grant on an
 * all-clients turn.
 */
export function fileToolsAllowed(
  consent: FileAccessConsent | undefined,
  currentScope: ConsentScope,
): boolean {
  if (!consent || consent.state !== 'granted' || !consent.grantedScope) return false;
  const granted = consent.grantedScope;
  if (granted.kind === 'allMatters') return true;
  // A single-client grant only covers that exact client — never another client,
  // never all-clients.
  return currentScope.kind === 'matter' && currentScope.matterId === granted.matterId;
}

/**
 * The narrowest scope that COVERS all of `scopes` — i.e. the scope a grant must
 * span to legitimately carry file content drawn from every one of them (F2.5b,
 * Codex round 4). Any all-clients input, or two different single clients, means
 * the combined content spans the whole practice, so the answer is bound to
 * all-clients; a set of same-client scopes stays that client. Used to compute a
 * turn's EFFECTIVE grounding scope when its answer draws on file content from
 * both fresh retrieval AND file-grounded conversation history.
 */
export function broadestConsentScope(scopes: ConsentScope[]): ConsentScope {
  let matterId: string | null = null;
  for (const s of scopes) {
    if (s.kind === 'allMatters') return { kind: 'allMatters' };
    if (matterId === null) matterId = s.matterId;
    else if (matterId !== s.matterId) return { kind: 'allMatters' };
  }
  // No single-client scope seen (empty input) → widest, the conservative default.
  return matterId === null ? { kind: 'allMatters' } : { kind: 'matter', matterId };
}

/**
 * True when the composer should show the "Allow file access" affordance — i.e.
 * file tools are currently gated OFF for this scope and the user could turn them
 * on. The inverse of {@link fileToolsAllowed}.
 */
export function needsFileAccessConsent(
  consent: FileAccessConsent | undefined,
  currentScope: ConsentScope,
): boolean {
  return !fileToolsAllowed(consent, currentScope);
}

/**
 * Whether the AI's file tools are actually REGISTERED on the provider for a send.
 * The SAME predicate MUST drive the system-prompt "you have file tools"
 * instructions, so the model is never told about tools it doesn't have (F2.5,
 * Codex P2). Tools register only for a CLOUD provider, with a workspace present,
 * once file access is consented for this scope.
 */
export function fileToolsRegistered(opts: {
  hasWorkspace: boolean;
  isCloudProvider: boolean;
  fileAccessGranted: boolean;
}): boolean {
  return opts.hasWorkspace && opts.isCloudProvider && opts.fileAccessGranted;
}

/**
 * Decide whether workspace RETRIEVAL runs for a send, and whether the ambient
 * Ask-my-workspace toggle was SUPPRESSED by missing consent (F2.5, Codex P1).
 *
 * "Reading is sending": a TYPED `@workspace` mention is per-message intent (the
 * user asked, right now) and is always allowed. The persistent Ask-my-workspace
 * TOGGLE is ambient, NOT per-message intent — for a CLOUD provider it would ship
 * workspace snippets to the vendor on every message, so it requires the same
 * file-access consent. Local providers never leak, so ambient retrieval is always
 * allowed there.
 */
export function resolveWorkspaceRetrieval(opts: {
  /** User typed `@workspace` in THIS message. */
  explicitWorkspace: boolean;
  /** The persistent per-chat Ask-my-workspace toggle. */
  askWorkspaceMode: boolean;
  isCloudProvider: boolean;
  fileAccessGranted: boolean;
}): { shouldRetrieve: boolean; ambientBlockedByConsent: boolean } {
  const { explicitWorkspace, askWorkspaceMode, isCloudProvider, fileAccessGranted } = opts;
  const ambientBlockedByConsent =
    askWorkspaceMode && !explicitWorkspace && isCloudProvider && !fileAccessGranted;
  const shouldRetrieve = explicitWorkspace || (askWorkspaceMode && !ambientBlockedByConsent);
  return { shouldRetrieve, ambientBlockedByConsent };
}
