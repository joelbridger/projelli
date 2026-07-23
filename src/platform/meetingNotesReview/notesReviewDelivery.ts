import type {
  ExactMeetingCrmReviewItem,
  ExactMeetingNotesReviewItem,
  ExactMeetingReviewKind,
  ExactMeetingTaskReviewItem,
  NotesReviewClientPair,
  NotesReviewCrmFieldChange,
  NotesReviewCrmFieldType,
  NotesReviewCrmFieldValue,
  NotesReviewDestination,
  NotesReviewItem,
  NotesReviewReceipt,
} from '@/ui/notesReview';
import type { MeetingVisibilitySubject } from '@/platform/meeting-visibility';

const STATE_FILE = 'notes-review.json';
const SCHEMA_VERSION = 1 as const;

export interface NotesReviewWorkspace {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface NotesReviewCrmDelivery {
  isConnected(): Promise<boolean>;
  saveProposal(proposal: {
    id: string;
    kind: 'note' | 'field';
    matterId: string;
    title: string;
    body: string;
    sourceRef: string;
    status: 'proposed';
    field?: string;
    existingValue?: string;
    newValue?: string;
    finalValue?: string;
    provenance?: string;
    /** Structured private-note lineage retained by the encrypted queue. */
    meetingVisibility?: MeetingVisibilitySubject;
  }): Promise<unknown>;
  prepareProposal(args: {
    proposalId: string;
    householdKey: string;
    requestedAt: string;
  }): Promise<unknown>;
  approveProposal(
    proposalId: string
  ): Promise<{ remoteId: string; deduped: boolean }>;
}

interface StoredItem extends NotesReviewItem {
  receipt?: NotesReviewReceipt;
  crmAttempt?: {
    proposalId: string;
    requestedAt: string;
  };
}

interface StoredState {
  schemaVersion: typeof SCHEMA_VERSION;
  items: StoredItem[];
}

export interface NotesReviewRepository {
  load(): Promise<StoredState>;
  approve(item: NotesReviewItem): Promise<NotesReviewReceipt>;
}

export interface MakeNotesReviewRepositoryInput {
  workspace: NotesReviewWorkspace;
  meetingDir: string;
  matterId: string;
  summaryText: string;
  summaryHtml?: string;
  crm?: NotesReviewCrmDelivery;
  householdKey?: string | null;
  now?: () => string;
  meetingVisibilityParent?: MeetingVisibilitySubject;
}

/**
 * Turns the actual generated meeting note into proposals. Semantic Word-list
 * items are read from Mammoth's HTML because its raw-text extraction drops
 * Word's list markers. Literal text bullets remain supported as a fallback.
 * Only list items under the Action items heading become proposals; a sentence
 * elsewhere in the summary cannot accidentally become a task or external
 * write.
 */
export function proposalsFromMeetingSummary(
  summaryText: string,
  meetingDir: string,
  summaryHtml?: string
): NotesReviewItem[] {
  const texts = [
    ...actionItemTextsFromSemanticHtml(summaryHtml ?? ''),
    ...actionItemTextsFromPlainText(summaryText),
  ];
  const items = texts.map((text) => {
    const id = `action-${stableId(`${meetingDir}\n${text}`)}`;
    return {
      id,
      title: text,
      detail: text,
      destination: 'task' as const,
      sourceLabel: 'Meeting action item',
    };
  });
  return dedupeById(items);
}

function actionItemTextsFromPlainText(summaryText: string): string[] {
  const items: string[] = [];
  let inActionItems = false;
  for (const rawLine of summaryText.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isHeading(line)) {
      inActionItems = normalizeHeading(line) === 'action items';
      continue;
    }
    if (!inActionItems) continue;
    const text = line.replace(/^(?:[-*•]|\d+[.)])\s+/, '').trim();
    if (!text || (text === line && !/^(?:[-*•]|\d+[.)])\s+/.test(line)))
      continue;
    items.push(text);
  }
  return items;
}

function actionItemTextsFromSemanticHtml(summaryHtml: string): string[] {
  if (!summaryHtml.trim() || typeof DOMParser === 'undefined') return [];

  const document = new DOMParser().parseFromString(summaryHtml, 'text/html');
  const items: string[] = [];
  let inActionItems = false;

  for (const block of Array.from(document.body.children)) {
    const blockText = normalizeInlineText(block.textContent ?? '');
    if (isSemanticSectionHeading(block, blockText)) {
      inActionItems = normalizeHeading(blockText) === 'action items';
      continue;
    }
    if (!inActionItems) continue;

    for (const listItem of Array.from(block.querySelectorAll('li'))) {
      const clone = listItem.cloneNode(true) as HTMLElement;
      for (const nestedList of Array.from(clone.querySelectorAll('ul, ol'))) {
        nestedList.remove();
      }
      const text = normalizeInlineText(clone.textContent ?? '').replace(
        /^(?:[-*•]|\d+[.)])\s+/,
        ''
      );
      if (text) items.push(text);
    }
  }

  return items;
}

function isSemanticSectionHeading(block: Element, text: string): boolean {
  const tagName = block.tagName.toLowerCase();
  return /^h[1-6]$/.test(tagName) || (tagName === 'p' && isHeading(text));
}

function normalizeInlineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A meeting-folder repository makes proposals and their receipts survive a
 * restart. The record is saved before a CRM request is allowed to leave the
 * app, which gives a retry the same proposal id and approval timestamp.
 */
export function makeNotesReviewRepository(
  input: MakeNotesReviewRepositoryInput
): NotesReviewRepository {
  const statePath = `${input.meetingDir}/${STATE_FILE}`;
  const sourceItems = proposalsFromMeetingSummary(
    input.summaryText,
    input.meetingDir,
    input.summaryHtml
  );
  const now = input.now ?? (() => new Date().toISOString());

  async function load(): Promise<StoredState> {
    const existing = await readState();
    const merged = mergeSourceItems(existing.items, sourceItems);
    // Loading a review is read-only. The first durable write happens only
    // after the advisor approves one exact item.
    return { schemaVersion: SCHEMA_VERSION, items: merged };
  }

  async function approve(item: NotesReviewItem): Promise<NotesReviewReceipt> {
    const state = await load();
    const existing = state.items.find((candidate) => candidate.id === item.id);
    if (!existing)
      throw new Error(
        'This proposal is no longer part of this meeting note. Refresh and review it again.'
      );
    if (existing.receipt) return existing.receipt;
    const proposal = { ...existing, ...item };

    if (proposal.destination === 'crm') {
      return deliverToCrm(proposal, state);
    }
    const receipt = await deliverLocally(proposal);
    const saved = replaceItem(state.items, { ...proposal, receipt });
    await writeState({ schemaVersion: SCHEMA_VERSION, items: saved });
    return receipt;
  }

  async function deliverToCrm(
    item: StoredItem,
    state: StoredState
  ): Promise<NotesReviewReceipt> {
    if (!input.meetingVisibilityParent) {
      throw new Error(
        'This meeting update is missing its private-note lineage. Nothing was sent.'
      );
    }
    if (!input.crm || !input.householdKey) {
      throw new Error(
        'Link this client to one Wealthbox household before sending a CRM update.'
      );
    }
    if (!(await input.crm.isConnected())) {
      throw new Error(
        'Connect Wealthbox before sending a CRM update. Nothing was sent.'
      );
    }
    const attempt = item.crmAttempt ?? {
      proposalId: `meeting-note-${item.id}`,
      requestedAt: now(),
    };
    // This write is deliberately before the provider call. If the app closes
    // after Wealthbox accepts the write, retrying uses the same idempotency key.
    await writeState({
      schemaVersion: SCHEMA_VERSION,
      items: replaceItem(state.items, { ...item, crmAttempt: attempt }),
    });
    await input.crm.saveProposal({
      id: attempt.proposalId,
      kind: 'note',
      matterId: input.matterId,
      title: item.title,
      body: item.detail,
      sourceRef: `meeting:${input.meetingDir}#notes-review:${item.id}`,
      status: 'proposed',
      meetingVisibility: meetingVisibilityProposal(
        attempt.proposalId,
        input.meetingVisibilityParent
      ),
    });
    await input.crm.prepareProposal({
      proposalId: attempt.proposalId,
      householdKey: input.householdKey,
      requestedAt: attempt.requestedAt,
    });
    const result = await input.crm.approveProposal(attempt.proposalId);
    const receipt: NotesReviewReceipt = {
      status: 'sent',
      message: result.deduped
        ? `CRM update already delivered (receipt ${result.remoteId}).`
        : `CRM update delivered (receipt ${result.remoteId}).`,
    };
    const latest = await readState();
    await writeState({
      schemaVersion: SCHEMA_VERSION,
      items: replaceItem(latest.items, {
        ...item,
        crmAttempt: attempt,
        receipt,
      }),
    });
    return receipt;
  }

  async function deliverLocally(
    item: NotesReviewItem
  ): Promise<NotesReviewReceipt> {
    const destination = item.destination;
    if (destination === 'crm')
      throw new Error('CRM delivery must use the CRM write path.');
    const fileName = destinationFileName(destination);
    const path = `${input.meetingDir}/${fileName}`;
    const marker = `<!-- notes-review:${item.id} -->`;
    const current = await readOptional(path);
    if (!current.includes(marker)) {
      const content = `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${marker}\n${localEntry(item)}`;
      await input.workspace.writeFile(path, `${content}\n`);
    }
    const labels: Record<Exclude<NotesReviewDestination, 'crm'>, string> = {
      task: 'Task',
      'client-note': 'Client note',
      internal: 'Internal note',
    };
    return {
      status: 'saved',
      message: `${labels[destination]} saved in ${fileName}.`,
    };
  }

  async function readState(): Promise<StoredState> {
    const raw = await readOptional(statePath);
    if (!raw.trim()) return { schemaVersion: SCHEMA_VERSION, items: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredState(parsed))
      throw new Error(
        'The saved note-review record is invalid. Nothing was delivered.'
      );
    return {
      schemaVersion: SCHEMA_VERSION,
      items: parsed.items.map((item) => ({ ...item })),
    };
  }

  async function writeState(state: StoredState): Promise<void> {
    await input.workspace.writeFile(statePath, JSON.stringify(state, null, 2));
  }

  async function readOptional(path: string): Promise<string> {
    try {
      return await input.workspace.readFile(path);
    } catch (error) {
      // TauriFSBackend wraps its underlying filesystem error in a
      // FileOperationError. Its outer message is always "Failed to read file",
      // so inspect the cause for the real missing-file signal.
      if (isMissingFileError(error)) return '';
      // Tauri can reject with a plain string. The two filesystem wrappers then
      // preserve only their generic outer messages, so the original Windows
      // "file not found" detail is unavailable here. An explicit existence
      // check is the reliable fallback: false means this optional file has not
      // been created yet; an existing but unreadable file remains a hard error.
      try {
        if (!(await input.workspace.exists(path))) return '';
        // eslint-disable-next-line lantern-async/no-silent-failure -- preserve and rethrow the original read error below when this best-effort classification check also fails
      } catch {
        // Keep the original read failure. It is the operation that failed and
        // callers turn it into a safe, non-internal placeholder.
      }
      throw error;
    }
  }

  return { load, approve };
}

/**
 * Unix (Node/Tauri) and Windows report a missing file in unrelated words, so
 * both families of phrasing must be matched explicitly. Windows never
 * produces "enoent" or "not found" — its real text is "The system cannot
 * find the file/path specified" (Win32 ERROR_FILE_NOT_FOUND /
 * ERROR_PATH_NOT_FOUND), which shares no substring with the Unix forms.
 */
export function isMissingFileError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const causeMessage = error.cause instanceof Error ? error.cause.message : '';
  const text = `${error.message}\n${causeMessage}`;
  return (
    /not found|enoent|does not exist/i.test(text) ||
    /cannot find the (?:file|path) specified/i.test(text) ||
    /\bERROR_(?:FILE|PATH)_NOT_FOUND\b/.test(text)
  );
}

function isHeading(line: string): boolean {
  return /^(?:#+\s*)?[A-Za-z][A-Za-z ]+:?$/.test(line);
}

function normalizeHeading(line: string): string {
  return line
    .replace(/^#+\s*/, '')
    .replace(/:$/, '')
    .trim()
    .toLowerCase();
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function dedupeById(items: NotesReviewItem[]): NotesReviewItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function mergeSourceItems(
  stored: StoredItem[],
  source: NotesReviewItem[]
): StoredItem[] {
  const byId = new Map(stored.map((item) => [item.id, item]));
  const current = source.map((item) => ({
    ...item,
    ...(byId.get(item.id) ?? {}),
  }));
  // Never discard a prior proposal just because someone edited the generated
  // document. It remains visible until its saved receipt tells the truth.
  return [
    ...current,
    ...stored.filter(
      (item) => !source.some((candidate) => candidate.id === item.id)
    ),
  ];
}

function replaceItem(
  items: StoredItem[],
  replacement: StoredItem
): StoredItem[] {
  return items.map((item) => (item.id === replacement.id ? replacement : item));
}

function destinationFileName(
  destination: Exclude<NotesReviewDestination, 'crm'>
): string {
  switch (destination) {
    case 'task':
      return 'Tasks.md';
    case 'client-note':
      return 'Client Notes.md';
    case 'internal':
      return 'Internal Notes.md';
  }
}

function localEntry(item: NotesReviewItem): string {
  if (item.destination === 'task')
    return `- [ ] ${item.title}\n  ${item.detail}`;
  return `## ${item.title}\n\n${item.detail}`;
}

function isStoredState(value: unknown): value is StoredState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { schemaVersion?: unknown; items?: unknown };
  if (
    candidate.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(candidate.items)
  )
    return false;
  return candidate.items.every((item) => isStoredItem(item));
}

function isStoredItem(value: unknown): value is StoredItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<StoredItem>;
  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.detail === 'string' &&
    (item.destination === 'task' ||
      item.destination === 'crm' ||
      item.destination === 'client-note' ||
      item.destination === 'internal')
  );
}

// ── Foundation exact-meeting proposal contract ─────────────────────────────

export const EXACT_MEETING_REVIEW_SCHEMA_VERSION = 2 as const;

/**
 * Runtime fail-closed guard for the exact meeting plus client pair. The type
 * contract requires all three values, but persisted or bridged data can still
 * arrive malformed at runtime.
 */
export function hasCompleteExactMeetingReviewIdentity(
  meetingId: unknown,
  client:
    | {
        readonly householdRef?: unknown;
        readonly matterId?: unknown;
      }
    | null
    | undefined
): boolean {
  return (
    hasNonEmptyIdentityPart(meetingId) &&
    client !== null &&
    client !== undefined &&
    hasNonEmptyIdentityPart(client.householdRef) &&
    hasNonEmptyIdentityPart(client.matterId)
  );
}

export interface ExactMeetingTaskProposalPayload {
  readonly id: string;
  readonly kind: 'task';
  readonly title: string;
  readonly detail: string;
  readonly ownerRef: string | null;
  readonly dueDate: string | null;
  readonly transcriptRef: string;
  readonly sourceLabel?: string;
}

export interface ExactMeetingCrmProposalPayload {
  readonly id: string;
  readonly kind: 'crm-update';
  readonly title: string;
  readonly detail: string;
  readonly transcriptRef: string;
  readonly entityRef: string;
  readonly fields: readonly NotesReviewCrmFieldChange[];
  readonly sourceLabel?: string;
}

export type ExactMeetingReviewProposalPayload =
  | ExactMeetingTaskProposalPayload
  | ExactMeetingCrmProposalPayload;

export interface ExactMeetingReviewArtifact {
  readonly id: string;
  readonly meetingId: string;
  readonly householdRef: string;
  readonly matterId: string;
  readonly kind: 'action-update-proposal';
  readonly schemaVersion: number;
  readonly state: 'produced' | 'approved' | 'rejected';
  readonly producedAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly meetingVisibility?: MeetingVisibilitySubject;
  readonly decision?: {
    readonly id: string;
    readonly state: 'approved' | 'rejected';
    readonly at: string;
    readonly proposalRevision: string;
    readonly exactProposal: Readonly<Record<string, unknown>>;
  };
  readonly delivery?: {
    readonly key: string;
    readonly status: 'pending' | 'confirmed' | 'failed' | 'retryable';
    readonly at: string;
    readonly attempt: number;
    readonly receipt?: Readonly<Record<string, unknown>>;
    readonly message?: string;
  };
}

export interface ExactMeetingReviewArtifactReader {
  listForMeeting(
    meetingId: string,
    kinds?: readonly ['action-update-proposal']
  ): readonly ExactMeetingReviewArtifact[];
}

export interface ExactMeetingTaskDelivery {
  create(input: {
    deliveryKey: string;
    title: string;
    body: string;
    householdRef: {
      kind: 'household';
      id: string;
      matterId: string;
      label?: string;
    };
    assigneeUserId: string | null;
    status: 'open';
    due?: string;
    priority: 'normal';
    contextRefs: readonly [];
    meetingVisibilityParent: MeetingVisibilitySubject;
  }): Promise<{ readonly id: string }>;
}

export interface ExactMeetingReviewFacts<
  Client extends NotesReviewClientPair = NotesReviewClientPair,
> {
  readonly meetingId: string;
  readonly client: Client;
  readonly tasks: readonly ExactMeetingTaskReviewItem<Client>[];
  readonly crmUpdates: readonly ExactMeetingCrmReviewItem<Client>[];
  readonly proposedCount: number;
  readonly approvedCount: number;
}

export interface ExactMeetingNotesReviewRepository<
  Client extends NotesReviewClientPair = NotesReviewClientPair,
> {
  /** One exact read model shared by the Tasks, CRM-update, and Actions tabs. */
  readFacts(): Promise<ExactMeetingReviewFacts<Client>>;
  list(
    kind: ExactMeetingReviewKind
  ): Promise<readonly ExactMeetingNotesReviewItem<Client>[]>;
  approve(
    item: ExactMeetingNotesReviewItem<Client>
  ): Promise<NotesReviewReceipt>;
  reject(item: ExactMeetingNotesReviewItem<Client>): Promise<void>;
}

/**
 * The native capability is intentionally a separate repository.  It does not
 * reuse the provider-oriented approval ledger, local Maps, or renderer-side
 * proposal predicates: every list, approval, and delivery starts with a fresh
 * native verification of raw encrypted records.
 */
export interface NativeHendricksReviewPort {
  view(): Promise<{ readonly artifacts: readonly Record<string, unknown>[] }>;
  approve(artifactId: string): Promise<{ readonly artifacts: readonly Record<string, unknown>[] }>;
  deliverTask(): Promise<{ readonly id: string }>;
  deliverCrm(): Promise<{ readonly id: string }>;
}

export function makeNativeHendricksReviewRepository<
  Client extends NotesReviewClientPair,
>(input: {
  readonly meetingId: string;
  readonly client: Client;
  readonly port: NativeHendricksReviewPort;
}): ExactMeetingNotesReviewRepository<Client> {
  async function items(): Promise<readonly ExactMeetingNotesReviewItem<Client>[]> {
    const view = await input.port.view();
    const values = view.artifacts.map((artifact) => nativeItem(artifact, input.meetingId, input.client));
    if (values.length !== 2 || new Set(values.map((item) => item.id)).size !== 2)
      throw new Error('The verified Hendricks proposal set is incomplete.');
    const task = values.filter((item) => item.kind === 'task');
    const crm = values.filter((item) => item.kind === 'crm-update');
    if (task.length !== 1 || crm.length !== 1)
      throw new Error('The verified Hendricks proposal set is not exact.');
    return values;
  }

  async function readFacts(): Promise<ExactMeetingReviewFacts<Client>> {
    const all = await items();
    const tasks = all.filter((item): item is ExactMeetingTaskReviewItem<Client> => item.kind === 'task');
    const crmUpdates = all.filter((item): item is ExactMeetingCrmReviewItem<Client> => item.kind === 'crm-update');
    return {
      meetingId: input.meetingId,
      client: input.client,
      tasks,
      crmUpdates,
      proposedCount: all.filter((item) => item.approvalState === 'proposed').length,
      approvedCount: all.filter((item) => item.approvalState === 'approved').length,
    };
  }

  return {
    readFacts,
    async list(kind) {
      const facts = await readFacts();
      return kind === 'task' ? facts.tasks : facts.crmUpdates;
    },
    async approve(edited) {
      const before = await items();
      const source = before.find((item) => item.id === edited.id);
      // Edited fields are not a second proposal authority. The native payload
      // is the only allowed payload, so a changed renderer copy cannot write.
      if (!source || JSON.stringify(source) !== JSON.stringify(edited))
        throw new Error('The verified proposal changed. Refresh before approving.');
      if (source.approvalState === 'rejected')
        throw new Error('This proposal was rejected.');
      if (source.approvalState === 'proposed') await input.port.approve(source.artifactId);
      const approved = (await items()).find((item) => item.id === source.id);
      if (!approved || approved.approvalState !== 'approved' || JSON.stringify(approved) !== JSON.stringify({ ...source, approvalState: 'approved' }))
        throw new Error('Native approval could not be confirmed.');
      const result = approved.kind === 'task'
        ? await input.port.deliverTask()
        : await input.port.deliverCrm();
      return {
        status: approved.kind === 'task' ? 'created' : 'saved',
        message: approved.kind === 'task' ? 'Saved to local Tasks.' : 'Saved to the local CRM record.',
        deliveryKey: result.id,
      };
    },
    async reject() {
      throw new Error('This sealed walkthrough proposal cannot be changed in the renderer.');
    },
  };
}

function nativeItem<Client extends NotesReviewClientPair>(
  artifact: Record<string, unknown>,
  meetingId: string,
  client: Client
): ExactMeetingNotesReviewItem<Client> {
  const payload = record(artifact['payload'], 'Native Hendricks proposal');
  if (
    artifact['kind'] !== 'meeting_artifact' ||
    artifact['meetingId'] !== meetingId ||
    artifact['householdRef'] !== client.householdRef ||
    artifact['matterId'] !== client.matterId ||
    (artifact['state'] !== 'produced' && artifact['state'] !== 'approved')
  )
    throw new Error('The native Hendricks proposal did not match this meeting.');
  const common = {
    id: requiredText(payload['id'], 'Native proposal ID'),
    artifactId: requiredText(artifact['id'], 'Native artifact ID'),
    meetingId,
    client,
    title: requiredText(payload['title'], 'Native proposal title'),
    detail: requiredText(payload['detail'], 'Native proposal detail'),
    transcriptRef: requiredText(payload['transcriptRef'], 'Native transcript reference'),
    sourceLabel: requiredText(payload['sourceLabel'], 'Native source label'),
    approvalState: artifact['state'] === 'approved' ? ('approved' as const) : ('proposed' as const),
    proposalRevision: stableProposalRevision(payload),
  };
  if (payload['kind'] === 'task') {
    return {
      ...common,
      kind: 'task',
      ownerRef: nullableText(payload['ownerRef'], 'Native task owner'),
      dueDate: nullableDate(payload['dueDate']),
    };
  }
  if (payload['kind'] === 'crm-update') {
    return {
      ...common,
      kind: 'crm-update',
      entityRef: requiredText(payload['entityRef'], 'Native CRM entity'),
      fields: [{
        field: requiredText(payload['field'], 'Native CRM field'),
        label: requiredText(payload['field'], 'Native CRM field'),
        valueType: payload['valueType'] === 'text' ? 'text' : (() => { throw new Error('Native CRM value type is invalid.'); })(),
        before: crmValue(payload['before'], 'text'),
        proposed: crmValue(payload['proposed'], 'text'),
      }],
    };
  }
  throw new Error('Native proposal kind is invalid.');
}

export interface MakeExactMeetingNotesReviewRepositoryInput<
  Client extends NotesReviewClientPair,
> {
  readonly meetingId: string;
  readonly client: Client;
  readonly artifacts: ExactMeetingReviewArtifactReader;
  readonly decideArtifact: (
    artifactId: string,
    transition: {
      readonly from: 'produced';
      readonly to: 'approved' | 'rejected';
      readonly at: string;
      readonly decisionId: string;
      readonly proposalRevision: string;
      readonly exactProposal: Readonly<Record<string, unknown>>;
    }
  ) => Promise<ExactMeetingReviewArtifact>;
  readonly recordDelivery: (input: {
    readonly artifactId: string;
    readonly key: string;
    readonly status: 'pending' | 'confirmed' | 'failed' | 'retryable';
    readonly at: string;
    readonly attempt: number;
    readonly receipt?: Readonly<Record<string, unknown>>;
    readonly message?: string;
  }) => Promise<ExactMeetingReviewArtifact>;
  /** Trusted composition callback; re-reads live scope and permission truth. */
  readonly assertEgressAuthority: (expected: {
    readonly artifactId: string;
    readonly proposalRevision: string;
    readonly deliveryKey: string;
  }) => void | Promise<void>;
  readonly taskDelivery: ExactMeetingTaskDelivery;
  readonly crmDelivery: NotesReviewCrmDelivery;
  /** Result of the shared meeting-visibility resolver for the current viewer. */
  readonly canReadArtifact?: (artifact: ExactMeetingReviewArtifact) => boolean;
  readonly now?: () => string;
}

/** Approval is durable even when the later destination reports a failure. */
export class ApprovedMeetingProposalDeliveryError extends Error {
  readonly approvalRecorded = true as const;
  readonly retryable: boolean;

  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? `Approval was recorded, but delivery failed: ${cause.message}`
        : 'Approval was recorded, but delivery failed.'
    );
    this.name = 'ApprovedMeetingProposalDeliveryError';
    this.cause = cause;
    this.retryable = deliveryFailureStatus(cause) === 'retryable';
  }
}

export class MeetingProposalEgressAuthorityError extends Error {
  readonly retryable = false as const;
}

export class AmbiguousMeetingProposalDeliveryError extends Error {
  readonly approvalRecorded = true as const;
  readonly outcomeUnknown = true as const;

  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? `Delivery may have succeeded, but its receipt could not be saved: ${cause.message}`
        : 'Delivery may have succeeded, but its receipt could not be saved.'
    );
    this.name = 'AmbiguousMeetingProposalDeliveryError';
    this.cause = cause;
  }
}

/**
 * Builds the single exact-meeting reader used by both review tabs and later by
 * Actions. It never scans another meeting and never writes while reading.
 */
export function makeExactMeetingNotesReviewRepository<
  Client extends NotesReviewClientPair,
>(
  input: MakeExactMeetingNotesReviewRepositoryInput<Client>
): ExactMeetingNotesReviewRepository<Client> {
  const now = input.now ?? (() => new Date().toISOString());

  const assertCompleteIdentity = (): void => {
    if (!hasCompleteExactMeetingReviewIdentity(input.meetingId, input.client)) {
      throw new Error(
        'This meeting proposal is missing its complete meeting and client identity. Nothing was read or changed.'
      );
    }
  };

  function readFacts(): Promise<ExactMeetingReviewFacts<Client>> {
    return Promise.resolve().then(() => {
      // Reject before the artifact reader can see an empty or partial scope.
      assertCompleteIdentity();
      const artifacts = input.artifacts.listForMeeting(input.meetingId, [
        'action-update-proposal',
      ]);
      const exact = artifacts
        .filter(
          (artifact) =>
            artifact.meetingId === input.meetingId &&
            artifact.householdRef === input.client.householdRef &&
            artifact.matterId === input.client.matterId &&
            artifact.schemaVersion >= EXACT_MEETING_REVIEW_SCHEMA_VERSION
        )
        .filter((artifact) => {
          const subject = artifactMeetingVisibility(artifact);
          return subject.lineage === 'legacy-unrestricted'
            ? true
            : input.canReadArtifact?.(artifact) === true;
        });
      const items = exact.flatMap((artifact) =>
        proposalsFromArtifact(artifact, input.client)
      );
      assertUniqueProposalIds(items);
      const tasks = items.filter(
        (item): item is ExactMeetingTaskReviewItem<Client> =>
          item.kind === 'task'
      );
      const crmUpdates = items.filter(
        (item): item is ExactMeetingCrmReviewItem<Client> =>
          item.kind === 'crm-update'
      );
      return {
        meetingId: input.meetingId,
        client: input.client,
        tasks,
        crmUpdates,
        proposedCount: items.filter((item) => item.approvalState === 'proposed')
          .length,
        approvedCount: items.filter((item) => item.approvalState === 'approved')
          .length,
      };
    });
  }

  async function list(
    kind: ExactMeetingReviewKind
  ): Promise<readonly ExactMeetingNotesReviewItem<Client>[]> {
    const facts = await readFacts();
    return kind === 'task' ? facts.tasks : facts.crmUpdates;
  }

  async function approve(
    edited: ExactMeetingNotesReviewItem<Client>
  ): Promise<NotesReviewReceipt> {
    // Approval must fail before even re-reading when its scope is incomplete.
    assertCompleteIdentity();
    const facts = await readFacts();
    const source = [...facts.tasks, ...facts.crmUpdates].find(
      (item) => item.id === edited.id
    );
    if (!source || !sameExactProposalIdentity(source, edited)) {
      throw new Error(
        'This proposal does not belong to this meeting and client. Refresh and review it again.'
      );
    }
    if (source.approvalState === 'rejected')
      throw new Error('This proposal was rejected and cannot be delivered.');
    if (source.delivery?.status === 'failed')
      throw new Error('This delivery failed permanently and cannot be retried.');
    if (source.delivery?.status === 'pending')
      throw new Error(
        'This delivery outcome is unknown. Check the destination before doing anything else.'
      );
    const validated = validateEditedProposal(source, edited);
    if (edited.proposalRevision !== source.proposalRevision)
      throw new Error(
        'This proposal changed while you were reviewing it. Refresh and review it again.'
      );
    const exactProposal = proposalForDecision(validated);
    const decisionRevision = stableProposalRevision(exactProposal);
    const deliveryKey = stableDeliveryKey(source.artifactId, decisionRevision);

    if (
      source.approvalState === 'approved' &&
      source.delivery?.status === 'confirmed'
    ) {
      return receiptFromStoredDelivery(source.delivery, deliveryKey);
    }

    // Connectivity is a read-only preflight. A known disconnected provider
    // should not consume the one legal approval transition.
    assertCompleteIdentity();
    if (
      validated.kind === 'crm-update' &&
      !(await input.crmDelivery.isConnected())
    ) {
      throw new Error(
        'Connect Wealthbox before sending a CRM update. Nothing was sent.'
      );
    }

    // The append-only approval transition is the authorization token. No task
    // or CRM destination is touched until this exact artifact accepts it.
    assertCompleteIdentity();
    if (source.approvalState === 'proposed') {
      await input.decideArtifact(source.artifactId, {
        from: 'produced',
        to: 'approved',
        at: now(),
        decisionId: `meeting-decision-${stableId(`${source.artifactId}\n${decisionRevision}`)}`,
        proposalRevision: decisionRevision,
        exactProposal,
      });
    }

    const attempt = (source.delivery?.attempt ?? 0) + 1;
    await input.recordDelivery({
      artifactId: source.artifactId,
      key: deliveryKey,
      status: 'pending',
      at: now(),
      attempt,
    });

    // Re-read through the scoped artifact reader after the pending record. A
    // client, permission, workspace, or revision change stops before egress.
    const current = await readCurrentItem(source.id);
    if (
      current.approvalState !== 'approved' ||
      current.proposalRevision !== decisionRevision ||
      current.delivery?.key !== deliveryKey
    )
      throw new Error(
        'The approved proposal changed before delivery. Nothing was sent.'
      );
    await assertLiveEgressAuthority(current, deliveryKey);

    let receipt: NotesReviewReceipt;
    try {
      assertCompleteIdentity();
      receipt =
        current.kind === 'task'
          ? await deliverExactTask(
              current,
              input.taskDelivery,
              deliveryKey,
              () => assertLiveEgressAuthority(current, deliveryKey)
            )
          : await deliverExactCrm(
              current,
              input.crmDelivery,
              deliveryKey,
              () => assertLiveEgressAuthority(current, deliveryKey)
            );
    } catch (error) {
      await input.recordDelivery({
        artifactId: source.artifactId,
        key: deliveryKey,
        status: deliveryFailureStatus(error),
        at: now(),
        attempt,
        message: error instanceof Error ? error.message : 'Delivery failed.',
      });
      throw new ApprovedMeetingProposalDeliveryError(error);
    }
    // Confirmation is outside the destination-error catch. If the destination
    // succeeded but this local receipt write fails, the pending state remains
    // deliberately non-retryable; repeating an unknown send would be unsafe.
    try {
      await input.recordDelivery({
        artifactId: source.artifactId,
        key: deliveryKey,
        status: 'confirmed',
        at: now(),
        attempt,
        receipt: { ...receipt, deliveryKey },
      });
    } catch (error) {
      throw new AmbiguousMeetingProposalDeliveryError(error);
    }
    return { ...receipt, deliveryKey };
  }

  async function reject(
    edited: ExactMeetingNotesReviewItem<Client>
  ): Promise<void> {
    assertCompleteIdentity();
    const source = await readCurrentItem(edited.id);
    if (!sameExactProposalIdentity(source, edited))
      throw new Error(
        'This proposal does not belong to this meeting and client.'
      );
    if (source.approvalState !== 'proposed')
      throw new Error(`This proposal is already ${source.approvalState}.`);
    if (edited.proposalRevision !== source.proposalRevision)
      throw new Error(
        'This proposal changed while you were reviewing it. Refresh and review it again.'
      );
    const validated = validateEditedProposal(source, edited);
    await input.decideArtifact(source.artifactId, {
      from: 'produced',
      to: 'rejected',
      at: now(),
      decisionId: `meeting-decision-${stableId(`${source.artifactId}\n${stableProposalRevision(proposalForDecision(validated))}`)}`,
      proposalRevision: stableProposalRevision(proposalForDecision(validated)),
      exactProposal: proposalForDecision(validated),
    });
  }

  async function readCurrentItem(
    id: string
  ): Promise<ExactMeetingNotesReviewItem<Client>> {
    const facts = await readFacts();
    const current = [...facts.tasks, ...facts.crmUpdates].find(
      (item) => item.id === id
    );
    if (!current)
      throw new Error(
        'This proposal is no longer available. Nothing was changed.'
      );
    return current;
  }

  async function assertLiveEgressAuthority(
    item: ExactMeetingNotesReviewItem<Client>,
    deliveryKey: string
  ): Promise<void> {
    await input.assertEgressAuthority({
      artifactId: item.artifactId,
      proposalRevision: item.proposalRevision,
      deliveryKey,
    });
  }

  return { readFacts, list, approve, reject };
}

/** Actions consumes these facts instead of constructing a second artifact reader. */
export function readExactMeetingReviewFactsForActions<
  Client extends NotesReviewClientPair,
>(
  repository: ExactMeetingNotesReviewRepository<Client>
): Promise<ExactMeetingReviewFacts<Client>> {
  return repository.readFacts();
}

function proposalsFromArtifact<Client extends NotesReviewClientPair>(
  artifact: ExactMeetingReviewArtifact,
  client: Client
): ExactMeetingNotesReviewItem<Client>[] {
  artifactMeetingVisibility(artifact);
  // One artifact is one independently approvable item. An array here would
  // let one artifact transition approve several proposals at once.
  const raw = artifact.decision?.exactProposal ?? artifact.payload['proposal'];
  if (!raw) {
    throw new Error('The meeting proposal artifact is malformed.');
  }
  return [proposalFromUnknown(raw, artifact, client)];
}

function proposalFromUnknown<Client extends NotesReviewClientPair>(
  value: unknown,
  artifact: ExactMeetingReviewArtifact,
  client: Client
): ExactMeetingNotesReviewItem<Client> {
  const proposal = record(value, 'Meeting proposal');
  const meetingVisibility = artifactMeetingVisibility(artifact);
  const common = {
    id: requiredText(proposal['id'], 'Proposal ID'),
    artifactId: artifact.id,
    meetingId: artifact.meetingId,
    client,
    title: requiredText(proposal['title'], 'Proposal title'),
    detail: requiredText(proposal['detail'], 'Proposal detail'),
    transcriptRef: requiredText(
      proposal['transcriptRef'],
      'Proposal transcript reference'
    ),
    ...(optionalText(proposal['sourceLabel'])
      ? { sourceLabel: optionalText(proposal['sourceLabel']) as string }
      : {}),
    approvalState:
      artifact.state === 'produced' ? ('proposed' as const) : artifact.state,
    proposalRevision:
      artifact.decision?.proposalRevision ?? stableProposalRevision(proposal),
    ...(artifact.delivery
      ? {
          delivery: {
            key: artifact.delivery.key,
            status: artifact.delivery.status,
            attempt: artifact.delivery.attempt,
            ...(artifact.delivery.message
              ? { message: artifact.delivery.message }
              : {}),
            ...(artifact.delivery.receipt
              ? {
                  receipt: artifact.delivery
                    .receipt as unknown as NotesReviewReceipt,
                }
              : {}),
          },
        }
      : {}),
    meetingVisibility,
  };
  if (proposal['kind'] === 'task') {
    return {
      ...common,
      kind: 'task',
      ownerRef: nullableText(proposal['ownerRef'], 'Task owner'),
      dueDate: nullableDate(proposal['dueDate']),
    };
  }
  if (proposal['kind'] === 'crm-update') {
    const fields = proposal['fields'];
    if (!Array.isArray(fields) || fields.length === 0)
      throw new Error(
        'A CRM update must include at least one before/after field.'
      );
    return {
      ...common,
      kind: 'crm-update',
      entityRef: requiredText(proposal['entityRef'], 'CRM entity reference'),
      fields: fields.map(crmFieldFromUnknown),
    };
  }
  throw new Error('Meeting proposal kind is invalid.');
}

function crmFieldFromUnknown(value: unknown): NotesReviewCrmFieldChange {
  const field = record(value, 'CRM field change');
  if (!Object.prototype.hasOwnProperty.call(field, 'before')) {
    throw new Error('A CRM field change is missing its real before value.');
  }
  const valueType = field['valueType'];
  if (
    valueType !== 'text' &&
    valueType !== 'number' &&
    valueType !== 'date' &&
    valueType !== 'boolean'
  ) {
    throw new Error('CRM field value type is invalid.');
  }
  const before = crmValue(field['before'], valueType);
  const proposed = crmValue(field['proposed'], valueType);
  return {
    field: requiredText(field['field'], 'CRM field'),
    label: requiredText(field['label'], 'CRM field label'),
    valueType,
    before,
    proposed,
  };
}

function validateEditedProposal<Client extends NotesReviewClientPair>(
  source: ExactMeetingNotesReviewItem<Client>,
  edited: ExactMeetingNotesReviewItem<Client>
): ExactMeetingNotesReviewItem<Client> {
  if (source.kind === 'task' && edited.kind === 'task') {
    return {
      ...source,
      title: requiredText(edited.title, 'Task title'),
      detail: requiredText(edited.detail, 'Task detail'),
      ownerRef: nullableText(edited.ownerRef, 'Task owner'),
      dueDate: nullableDate(edited.dueDate),
    };
  }
  if (source.kind === 'crm-update' && edited.kind === 'crm-update') {
    const fieldsChanged = source.fields.some((field, index) => {
      const candidate = edited.fields.at(index);
      return (
        !candidate ||
        field.field !== candidate.field ||
        field.valueType !== candidate.valueType ||
        field.before !== candidate.before
      );
    });
    if (source.fields.length !== edited.fields.length || fieldsChanged) {
      throw new Error(
        'CRM before values and field identities cannot be changed.'
      );
    }
    return {
      ...source,
      title: requiredText(edited.title, 'CRM proposal title'),
      detail: requiredText(edited.detail, 'CRM proposal detail'),
      fields: source.fields.map((field, index) => {
        const candidate = edited.fields.at(index);
        if (!candidate) throw new Error('CRM field changes cannot be removed.');
        return {
          ...field,
          proposed: crmValue(candidate.proposed, field.valueType),
        };
      }),
    };
  }
  throw new Error('The proposal kind cannot be changed.');
}

async function deliverExactTask<Client extends NotesReviewClientPair>(
  item: ExactMeetingTaskReviewItem<Client>,
  delivery: ExactMeetingTaskDelivery,
  deliveryKey: string,
  assertEgressAuthority: () => Promise<void>
): Promise<NotesReviewReceipt> {
  const parent = artifactMeetingVisibility(itemArtifact(item));
  // The repository already rechecked after staging; this is the final check
  // immediately adjacent to the destination write.
  await assertEgressAuthority();
  const created = await delivery.create({
    deliveryKey,
    title: item.title,
    body: item.detail,
    householdRef: {
      kind: 'household',
      id: item.client.householdRef,
      matterId: item.client.matterId,
      ...(item.client.displayName ? { label: item.client.displayName } : {}),
    },
    assigneeUserId: item.ownerRef,
    status: 'open',
    ...(item.dueDate ? { due: item.dueDate } : {}),
    priority: 'normal',
    contextRefs: [],
    meetingVisibilityParent: parent,
  });
  return {
    status: 'created',
    message: `Task created (receipt ${created.id}).`,
  };
}

async function deliverExactCrm<Client extends NotesReviewClientPair>(
  item: ExactMeetingCrmReviewItem<Client>,
  delivery: NotesReviewCrmDelivery,
  deliveryKey: string,
  assertEgressAuthority: () => Promise<void>
): Promise<NotesReviewReceipt> {
  const parent = artifactMeetingVisibility(itemArtifact(item));
  const receipts: string[] = [];
  for (const field of item.fields) {
    const proposalId = `meeting-review-${stableId(
      `${deliveryKey}\n${field.field}`
    )}`;
    const requestedAt = new Date().toISOString();
    await assertEgressAuthority();
    await delivery.saveProposal({
      id: proposalId,
      kind: 'field',
      matterId: item.client.matterId,
      title: item.title,
      body: item.detail,
      sourceRef: item.transcriptRef,
      status: 'proposed',
      field: field.field,
      existingValue: crmValueForTransport(field.before),
      newValue: crmValueForTransport(field.proposed),
      finalValue: crmValueForTransport(field.proposed),
      meetingVisibility: meetingVisibilityProposal(proposalId, parent),
    });
    await assertEgressAuthority();
    await delivery.prepareProposal({
      proposalId,
      householdKey: item.client.householdRef,
      requestedAt,
    });
    await assertEgressAuthority();
    const result = await delivery.approveProposal(proposalId);
    receipts.push(result.remoteId);
  }
  return {
    status: 'sent',
    message: `CRM update delivered (${receipts.length.toString()} field${
      receipts.length === 1 ? '' : 's'
    }; receipts ${receipts.join(', ')}).`,
  };
}

function deliveryFailureStatus(
  error: unknown
): 'failed' | 'retryable' {
  return error instanceof MeetingProposalEgressAuthorityError ||
    (error &&
      typeof error === 'object' &&
      'retryable' in error &&
      error.retryable === false)
    ? 'failed'
    : 'retryable';
}

function itemArtifact(item: ExactMeetingNotesReviewItem): ExactMeetingReviewArtifact {
  return {
    id: item.artifactId,
    meetingId: item.meetingId,
    householdRef: item.client.householdRef,
    matterId: item.client.matterId,
    kind: 'action-update-proposal',
    schemaVersion: EXACT_MEETING_REVIEW_SCHEMA_VERSION,
    state: item.approvalState === 'proposed' ? 'produced' : item.approvalState,
    producedAt: '',
    payload: {},
    ...((
      item as ExactMeetingNotesReviewItem & {
        meetingVisibility?: MeetingVisibilitySubject;
      }
    ).meetingVisibility
      ? {
          meetingVisibility: (
            item as ExactMeetingNotesReviewItem & {
              meetingVisibility: MeetingVisibilitySubject;
            }
          ).meetingVisibility,
        }
      : {}),
  };
}

function artifactMeetingVisibility(
  artifact: ExactMeetingReviewArtifact
): MeetingVisibilitySubject {
  const candidate =
    artifact.meetingVisibility ?? artifact.payload['meetingVisibility'];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
    throw new Error(
      'The meeting proposal is missing its private-note lineage. Nothing was shown or delivered.'
    );
  const subject = candidate as MeetingVisibilitySubject;
  const exactArtifact = subject.kind === 'meeting-artifact' && subject.id === artifact.id;
  const exactLegacy = exactArtifact && subject.lineage === 'legacy-unrestricted';
  const exactDerived =
    exactArtifact &&
    subject.lineage === 'derived' &&
    subject.parentRef.kind === 'meeting-note' &&
    subject.parentRef.id === artifact.meetingId &&
    typeof subject.ownerRef === 'string' &&
    Boolean(subject.ownerRef.trim()) &&
    typeof subject.visibilityPolicyId === 'string' &&
    Boolean(subject.visibilityPolicyId.trim());
  if (!exactLegacy && !exactDerived)
    throw new Error(
      'The meeting proposal has conflicting private-note lineage. Nothing was shown or delivered.'
    );
  return subject;
}

function meetingVisibilityProposal(
  id: string,
  parent: MeetingVisibilitySubject
): MeetingVisibilitySubject {
  const subject: MeetingVisibilitySubject =
    parent.lineage === 'legacy-unrestricted'
      ? { kind: 'proposal', id, lineage: 'legacy-unrestricted' }
      : {
          kind: 'proposal',
          id,
          lineage: 'derived',
          parentRef: { kind: parent.kind, id: parent.id },
          ...(parent.ownerRef ? { ownerRef: parent.ownerRef } : {}),
          ...(parent.visibilityPolicyId
            ? { visibilityPolicyId: parent.visibilityPolicyId }
            : {}),
        };
  return subject;
}

function sameExactProposalIdentity(
  left: ExactMeetingNotesReviewItem,
  right: ExactMeetingNotesReviewItem
): boolean {
  return (
    left.id === right.id &&
    left.artifactId === right.artifactId &&
    left.meetingId === right.meetingId &&
    left.client.householdRef === right.client.householdRef &&
    left.client.matterId === right.client.matterId &&
    left.kind === right.kind &&
    (left.kind !== 'crm-update' ||
      (right.kind === 'crm-update' && left.entityRef === right.entityRef))
  );
}

function proposalForDecision(
  item: ExactMeetingNotesReviewItem
): Readonly<Record<string, unknown>> {
  const common = {
    id: item.id,
    kind: item.kind,
    title: item.title,
    detail: item.detail,
    transcriptRef: item.transcriptRef,
    ...(item.sourceLabel ? { sourceLabel: item.sourceLabel } : {}),
  };
  return item.kind === 'task'
    ? { ...common, ownerRef: item.ownerRef, dueDate: item.dueDate }
    : { ...common, entityRef: item.entityRef, fields: item.fields };
}

function stableProposalRevision(proposal: Record<string, unknown>): string {
  return `proposal-${stableId(canonicalJson(proposal))}`;
}

function stableDeliveryKey(
  artifactId: string,
  proposalRevision: string
): string {
  return `meeting-delivery-${stableId(`${artifactId}\n${proposalRevision}`)}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function receiptFromStoredDelivery(
  delivery: NonNullable<ExactMeetingNotesReviewItem['delivery']>,
  expectedKey: string
): NotesReviewReceipt {
  if (delivery.key !== expectedKey || !delivery.receipt)
    throw new Error(
      'The confirmed delivery receipt is incomplete. Nothing was repeated.'
    );
  return { ...delivery.receipt, deliveryKey: delivery.key };
}

function assertUniqueProposalIds(
  items: readonly ExactMeetingNotesReviewItem[]
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id))
      throw new Error(
        'Meeting proposal IDs must be unique within one meeting.'
      );
    seen.add(item.id);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} is malformed.`);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} is required.`);
  return value.trim();
}

function hasNonEmptyIdentityPart(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requiredText(value, label);
}

function nullableDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('Task due date must use YYYY-MM-DD or null.');
  return value;
}

function crmValue(
  value: unknown,
  type: NotesReviewCrmFieldType
): NotesReviewCrmFieldValue {
  if (value === null) return null;
  if (type === 'number' && typeof value === 'number' && Number.isFinite(value))
    return value;
  if (type === 'boolean' && typeof value === 'boolean') return value;
  if ((type === 'text' || type === 'date') && typeof value === 'string') {
    if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new Error('CRM date values must use YYYY-MM-DD.');
    return value;
  }
  throw new Error(`CRM ${type} value is malformed.`);
}

function crmValueForTransport(value: NotesReviewCrmFieldValue): string {
  if (value === null) return '';
  return String(value);
}
