import type {
  NotesReviewDestination,
  NotesReviewItem,
  NotesReviewReceipt,
} from '@/ui/notesReview';

const STATE_FILE = 'notes-review.json';
const SCHEMA_VERSION = 1 as const;

export interface NotesReviewWorkspace {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface NotesReviewCrmDelivery {
  isConnected(): Promise<boolean>;
  saveProposal(proposal: {
    id: string;
    kind: 'note';
    matterId: string;
    title: string;
    body: string;
    sourceRef: string;
    status: 'proposed';
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
    if (!statesEqual(existing.items, merged))
      await writeState({ schemaVersion: SCHEMA_VERSION, items: merged });
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

function statesEqual(left: StoredItem[], right: StoredItem[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
