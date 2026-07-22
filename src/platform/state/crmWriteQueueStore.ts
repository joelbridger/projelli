// CRM write-back approval queue.
//
// Holds proposed CRM writes (notes/tasks) drafted from a client's note or
// meeting until the advisor explicitly approves them via the review card.
//
// The restart-surviving copy lives in the encrypted Rust CRM store, not
// browser localStorage. The React/Zustand state below is only the in-memory
// preview list for the current screen.
//
// The ONLY call sites of `approve()` are the review card's Approve button
// and this file's own tests. Enqueuing never sends anything.

import { useMemo } from 'react';
import { create } from 'zustand';

import {
  crmApproveWriteProposal,
  crmDeleteWriteProposal,
  crmListWriteProposals,
  crmPrepareWriteProposal,
  crmSaveWriteProposal,
  type CrmWriteProposalPayload,
  type CrmWriteProposalRecord,
} from '@/platform/utils/wealthbox-commands';
import {
  composeFieldBlend,
  isWritableField,
  type PreparedFieldBlendRequest,
} from '@/platform/state/fieldBlend';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  canReadMeetingDerivedRecord,
  type MeetingVisibilitySubject,
} from '@/platform/meeting-visibility';
import {
  loadLiveCrmRecords,
  type LiveCrmRecord,
} from '@/platform/crm/liveRecords';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { getActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
import { useFirmStore } from '@/platform/firm/firmStore';

export type CrmWriteStatus = 'proposed' | 'sending' | 'sent' | 'failed' | 'verify_pending' | 'stale';

export interface ProposedCrmWrite {
  id: string;
  kind: 'note' | 'task' | 'field';
  matterId: string;
  title: string;
  body: string;
  dueDate?: string;
  sourceRef: string;
  status: CrmWriteStatus;
  remoteId?: string;
  error?: string;
  /**
   * Identifies THIS approval event (an RFC3339 timestamp), not the content —
   * set once the first time this item is sent, then reused verbatim on every
   * retry of that same item. The backend's dedup ledger includes it in the
   * write's idempotency key: a retry with the same requestedAt collides with
   * (and is safely suppressed as) its own earlier attempt, while a later,
   * separate approval of identical content gets a fresh item (and thus a
   * fresh requestedAt) and is never mistaken for a duplicate. See
   * `crm_approve_write_proposal`'s Rust path in
   * `src-tauri/src/commands/crm/commands.rs`.
   */
  requestedAt?: string;
  /**
   * Task 9c — field-level blended update (`kind: 'field'` only). `field` is
   * the provider field path (e.g. `background_information`); `existingValue`
   * /`newValue` are the 3-column review's reference columns; `finalValue` is
   * the user-editable blend that actually gets written. `existingValue` is
   * REPLACED with the fresh live value if the backend's stale-guard rejects
   * the write because the field drifted since the proposal was drafted (see
   * the 'stale' status below).
   */
  field?: string;
  existingValue?: string;
  newValue?: string;
  finalValue?: string;
  /**
   * E3 (Tier B trust guard) — set on notes drafted BY the AI (today: a
   * meeting's notes.docx sent to the CRM). Carries just enough for the review
   * card to compose the honest provenance line at approve time; absent on
   * advisor-typed notes, tasks, and field updates.
   */
  aiSource?: { kind: 'meeting' | 'document'; date?: string };
  /**
   * The composed, localized provenance line, set ONCE at first approval and
   * reused verbatim on every retry (like `requestedAt`) so it stays stable and
   * the note content the advisor reviewed doesn't shift between attempts. Sent
   * to the backend, which appends it to the note content at the wire boundary.
   */
  provenance?: string;
  /** Structured authorization lineage for meeting-derived queue entries. */
  meetingVisibility?: MeetingVisibilitySubject;
}

interface CrmWriteQueueState {
  items: ProposedCrmWrite[];
  enqueue: (item: Omit<ProposedCrmWrite, 'id' | 'status'>) => void;
  hydrateFromBackend: () => Promise<void>;
  approve: (ids: string[], householdKey: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  /** Task 9c: the advisor editing a field item's Blended column. `kind:
   *  'field'` items only — a no-op on any other item. */
  updateFinalValue: (id: string, finalValue: string) => Promise<void>;
  /** E3: set the composed provenance line on an AI-drafted note, but only if
   *  not already set — so a retry keeps the exact line from the first approval
   *  (stable content). No-op once present. */
  setProvenanceIfUnset: (id: string, provenance: string) => Promise<void>;
  visibleItemsFresh: () => Promise<readonly ProposedCrmWrite[]>;
  /**
   * Task 9c: the ONLY way to enqueue a field-level blended update — computes
   * `finalValue` via `composeFieldBlend` (scalar replace / narrative merge /
   * deterministic fallback) before the item ever reaches the queue, so a
   * caller can never enqueue a field proposal with a blank blend. Calling
   * `enqueue()` directly with `kind: 'field'` and no `finalValue` is a bug —
   * this is the real entry point for that item shape.
   */
  enqueueFieldUpdate: (
    args: {
      matterId: string;
      title: string;
      field: string;
      existingValue: string;
      newValue: string;
      sourceRef: string;
    } & (
      | { send?: undefined }
      // Codex review catch (P2): this must be an audited send function, not a
      // raw provider, so the required egress receipt can't be silently skipped.
      | { send: (request: PreparedFieldBlendRequest) => Promise<string> }
    ),
  ) => Promise<void>;
}

function newId(): string {
  return `crmw-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

// Codex review catch (P2): a bare `new Date().toISOString()` is not
// guaranteed unique — two DIFFERENT items approved within the same
// millisecond (a real risk: approve() can move on to its next item as soon
// as a fast mocked/local call resolves) would get an identical requestedAt,
// and since the backend's dedup key doesn't include matterId/sourceRef, the
// second legitimate write would be silently treated as a retry of the first
// and dropped. Track the last-issued millisecond and always bump forward by
// at least 1ms, so a fresh requestedAt is strictly monotonic within this
// session no matter how fast two approvals fire back to back.
let lastRequestedAtMs = 0;
let visibilityRecords: readonly LiveCrmRecord[] = [];
let visibilityViewerId: string | null = null;
function newRequestedAt(): string {
  const now = Date.now();
  lastRequestedAtMs = now > lastRequestedAtMs ? now : lastRequestedAtMs + 1;
  return new Date(lastRequestedAtMs).toISOString();
}

function setItem(id: string, patch: Partial<ProposedCrmWrite>) {
  useCrmWriteQueueStore.setState((state) => ({
    items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  }));
}

/** Like `setItem`, but drops `error` entirely (retry clearing a prior failure). */
function setItemClearingError(id: string, patch: Partial<Omit<ProposedCrmWrite, 'error'>>) {
  useCrmWriteQueueStore.setState((state) => ({
    items: state.items.map((item) => {
      if (item.id !== id) return item;
      const { error: _drop, ...rest } = item;
      return { ...rest, ...patch };
    }),
  }));
}

// Matches the Rust CrmWriteError::StaleFieldValue Display impl exactly:
// "this field changed in the CRM since the proposal — current value: {0}".
// The captured group can legitimately contain newlines (it's the live field
// content), hence the /s flag.
const STALE_FIELD_VALUE_RE = /this field changed in the CRM since the proposal — current value: (.*)$/s;
const LEGACY_PLAINTEXT_QUEUE_KEY = 'crm-write-queue-storage';

function itemToProposalPayload(item: ProposedCrmWrite, householdKey?: string): CrmWriteProposalPayload {
  const payload: CrmWriteProposalPayload = {
    id: item.id,
    kind: item.kind,
    matterId: item.matterId,
    title: item.title,
    body: item.body,
    sourceRef: item.sourceRef,
    status: item.status,
  };
  if (item.dueDate !== undefined) payload.dueDate = item.dueDate;
  if (item.remoteId !== undefined) payload.remoteId = item.remoteId;
  if (item.error !== undefined) payload.error = item.error;
  if (item.requestedAt !== undefined) payload.requestedAt = item.requestedAt;
  if (item.field !== undefined) payload.field = item.field;
  if (item.existingValue !== undefined) payload.existingValue = item.existingValue;
  if (item.newValue !== undefined) payload.newValue = item.newValue;
  if (item.finalValue !== undefined) payload.finalValue = item.finalValue;
  if (item.provenance !== undefined) payload.provenance = item.provenance;
  if (item.meetingVisibility !== undefined)
    payload.meetingVisibility = item.meetingVisibility;
  if (item.aiSource !== undefined) payload.aiSource = item.aiSource;
  if (householdKey !== undefined) payload.householdKey = householdKey;
  return payload;
}

function recordToItem(record: CrmWriteProposalRecord): ProposedCrmWrite {
  const item: ProposedCrmWrite = {
    id: record.id,
    kind: record.kind,
    matterId: record.matterId,
    title: record.title,
    body: record.body,
    sourceRef: record.sourceRef,
    // A send that died with the app is not still running after restart.
    status: record.status === 'sending' ? 'proposed' : record.status,
  };
  if (record.dueDate !== undefined) item.dueDate = record.dueDate;
  if (record.remoteId !== undefined) item.remoteId = record.remoteId;
  if (record.error !== undefined) item.error = record.error;
  if (record.requestedAt !== undefined) item.requestedAt = record.requestedAt;
  if (record.field !== undefined) item.field = record.field;
  if (record.existingValue !== undefined) item.existingValue = record.existingValue;
  if (record.newValue !== undefined) item.newValue = record.newValue;
  if (record.finalValue !== undefined) item.finalValue = record.finalValue;
  if (record.provenance !== undefined) item.provenance = record.provenance;
  if (record.meetingVisibility !== undefined)
    item.meetingVisibility = record.meetingVisibility;
  if (record.aiSource !== undefined) item.aiSource = record.aiSource;
  return item;
}

async function persistProposalItem(item: ProposedCrmWrite, householdKey?: string): Promise<void> {
  await crmSaveWriteProposal(itemToProposalPayload(item, householdKey));
}

function persistProposalItemBestEffort(item: ProposedCrmWrite, householdKey?: string): void {
  void persistProposalItem(item, householdKey).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    setItem(item.id, {
      status: 'failed',
      error: `Could not save this CRM proposal securely: ${message}`,
    });
  });
}

function persistProposalItemSilently(item: ProposedCrmWrite, householdKey?: string): void {
  void persistProposalItem(item, householdKey).catch((error: unknown) => {
    // After a confirmed provider write, local cleanup must not turn the UI red.
    console.warn('[crmWriteQueueStore] Could not persist sent CRM proposal state:', error);
  });
}

function deleteProposalBestEffort(id: string): void {
  void crmDeleteWriteProposal(id).catch((error: unknown) => {
    // Deletion is retried by dismiss/send paths. Never log client proposal text.
    console.warn('[crmWriteQueueStore] Could not delete CRM proposal record:', error);
  });
}

async function sendOne(item: ProposedCrmWrite, householdKey: string): Promise<void> {
  // Defense-in-depth: the card is expected to disable Approve while a field
  // item's finalValue is blank, but the store must never fire a network call
  // for one even if that guard is somehow bypassed.
  if (item.kind === 'field' && (item.finalValue ?? '').trim() === '') return;

  // Set once, on this item's FIRST send attempt, then reused verbatim on
  // every retry (approve() re-fetches the item fresh from the store each
  // time it's called, so a manual Retry sees the value persisted below).
  // Never regenerated per attempt — that would defeat the backend's
  // retry-vs-fresh-approval dedup guarantee (see the field's doc comment).
  const requestedAt = item.requestedAt ?? newRequestedAt();
  const sendingItem: ProposedCrmWrite = { ...item, status: 'sending', requestedAt };
  setItemClearingError(item.id, { status: 'sending', requestedAt });
  try {
    await persistProposalItem(sendingItem, householdKey);
    await crmPrepareWriteProposal({
      proposalId: item.id,
      householdKey,
      requestedAt,
      ...(item.provenance ? { provenance: item.provenance } : {}),
    });
    const receipt = await crmApproveWriteProposal(item.id);
    const sentItem: ProposedCrmWrite = { ...sendingItem, status: 'sent', remoteId: receipt.remoteId };
    persistProposalItemSilently(sentItem, householdKey);
    deleteProposalBestEffort(item.id);
    setItemClearingError(item.id, { status: 'sent', remoteId: receipt.remoteId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const staleMatch = STALE_FIELD_VALUE_RE.exec(message);
    if (staleMatch) {
      // Coordinator review catch (P2): never blind-overwrite. Re-render the 3
      // columns with the fresh live value instead of the stale one the
      // proposal was drafted against — AND rebuild finalValue from it. The
      // OLD blend was computed against the OLD existingValue and never
      // accounts for the concurrent edit; leaving it in place let a later
      // retry (which resends this refreshed existingValue) pass the
      // backend's stale-guard and silently overwrite the concurrent change
      // the moment the live value stopped drifting further. No provider
      // handle survives a stale rejection (nothing is persisted on the
      // item), so this is always composeFieldBlend's deterministic
      // concatenation, even for an originally AI-blended narrative field —
      // correct-shape and never drops either side's content, which is what
      // matters for a rebuild the advisor hasn't reviewed yet.
      const freshExistingValue = staleMatch[1] ?? '';
      const rebuiltFinalValue = await composeFieldBlend({
        field: item.field ?? '',
        existingValue: freshExistingValue,
        newValue: item.newValue ?? '',
      });
      const staleItem: ProposedCrmWrite = {
        ...sendingItem,
        status: 'stale',
        error: message,
        existingValue: freshExistingValue,
        finalValue: rebuiltFinalValue,
      };
      setItem(item.id, staleItem);
      persistProposalItemBestEffort(staleItem, householdKey);
      return;
    }
    const status: CrmWriteStatus = message.includes('verification pending') ? 'verify_pending' : 'failed';
    const failedItem: ProposedCrmWrite = { ...sendingItem, status, error: message };
    setItem(item.id, failedItem);
    persistProposalItemBestEffort(failedItem, householdKey);
  }
}

const VALID_STATUSES: readonly CrmWriteStatus[] = [
  'proposed',
  'sending',
  'sent',
  'failed',
  'verify_pending',
  'stale',
];

function isValidPersistedItem(raw: unknown): raw is ProposedCrmWrite {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r['id'] === 'string' &&
    (r['kind'] === 'note' || r['kind'] === 'task' || r['kind'] === 'field') &&
    typeof r['matterId'] === 'string' &&
    typeof r['title'] === 'string' &&
    typeof r['body'] === 'string' &&
    typeof r['sourceRef'] === 'string' &&
    typeof r['status'] === 'string' &&
    (VALID_STATUSES as string[]).includes(r['status'])
  );
}

export function canReadQueueItem(
  item: ProposedCrmWrite,
  records: readonly LiveCrmRecord[],
  viewerId: string | null | undefined
): boolean {
  if (!item.meetingVisibility) return true;
  if (
    item.meetingVisibility.kind !== 'proposal' ||
    item.meetingVisibility.id !== item.id
  )
    return false;
  return canReadMeetingDerivedRecord(
    {
      id: item.id,
      kind: 'proposalRecord',
      source: { origin: 'meeting', sources: [] },
      meetingVisibility: item.meetingVisibility,
    },
    'proposal',
    records,
    viewerId
  );
}

export function projectVisibleCrmWriteQueueItems(
  items: readonly ProposedCrmWrite[],
  records: readonly LiveCrmRecord[],
  viewerId: string | null | undefined
): readonly ProposedCrmWrite[] {
  return items.filter((item) => canReadQueueItem(item, records, viewerId));
}

/** Re-project whenever the canonical policies, lineage, or firm viewer changes. */
export function useVisibleCrmWriteQueueItems(): readonly ProposedCrmWrite[] {
  const items = useCrmWriteQueueStore((state) => state.items);
  const records = useLiveCrmRecords().records;
  const viewerId = useFirmStore((state) => state.session?.userId ?? null);
  return useMemo(
    () => projectVisibleCrmWriteQueueItems(items, records, viewerId),
    [items, records, viewerId]
  );
}

async function refreshVisibilitySnapshot(): Promise<{
  readonly records: readonly LiveCrmRecord[];
  readonly viewerId: string | null;
}> {
  const workspaceRoot = getActiveWorkspaceService()?.getRootPath() ?? null;
  const records = await loadLiveCrmRecords(workspaceRoot);
  const viewerId = useFirmStore.getState().session?.userId ?? null;
  visibilityRecords = records;
  visibilityViewerId = viewerId;
  return { records, viewerId };
}

function canUseVisibleQueueItem(item: ProposedCrmWrite): boolean {
  return canReadQueueItem(item, visibilityRecords, visibilityViewerId);
}

/**
 * Reconciles a just-loaded queue against reality instead of trusting the
 * encrypted snapshot blindly.
 * Reads `useMatterStore` directly (a live, already-hydrated read — the
 * static import above guarantees matterStore's own module code, including
 * its own persist rehydration, has already run by the time this executes).
 */
function reconcileRehydratedItems(rawItems: unknown): ProposedCrmWrite[] {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const knownMatterIds = new Set(useMatterStore.getState().matters.map((m) => m.id));
  return items
    .filter(isValidPersistedItem)
    .filter((item) => item.status !== 'sent')
    .filter((item) => {
      // The matter this proposal targets is gone (deleted in a prior
      // session). Its only possible display surface is that matter's own
      // MatterHub, which a deleted matter can never open again — so there
      // is nowhere left this could ever be reviewed or dismissed. Drop it
      // rather than stranding a zombie entry in localStorage forever.
      return knownMatterIds.has(item.matterId);
    })
    .map((item) =>
      item.status === 'sending'
        // The in-flight send died with the app — nothing is actually
        // running, so re-open it for a fresh (deliberate) retry rather than
        // leaving it stuck disabled forever.
        ? { ...item, status: 'proposed' }
        : item,
    );
}

function readLegacyPlaintextQueue(): ProposedCrmWrite[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(LEGACY_PLAINTEXT_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { state?: { items?: unknown } };
    return reconcileRehydratedItems(parsed.state?.items);
  } catch {
    return [];
  }
}

function clearLegacyPlaintextQueue(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LEGACY_PLAINTEXT_QUEUE_KEY);
}

export const useCrmWriteQueueStore = create<CrmWriteQueueState>()((set, get) => ({
  items: [],

  enqueue: (item) => {
    const proposed: ProposedCrmWrite = { ...item, id: newId(), status: 'proposed' };
    if (proposed.meetingVisibility) {
      proposed.meetingVisibility = {
        ...proposed.meetingVisibility,
        kind: 'proposal',
        id: proposed.id,
      } as MeetingVisibilitySubject;
      if (!canUseVisibleQueueItem(proposed))
        throw new Error('This private meeting proposal is not available.');
    }
    set((state) => ({
      items: [...state.items, proposed],
    }));
    persistProposalItemBestEffort(proposed);
  },

  hydrateFromBackend: async () => {
    const records = await crmListWriteProposals();
    const visibility = await refreshVisibilitySnapshot();
    const allBackendItems = reconcileRehydratedItems(records.map(recordToItem));
    const backendItems = allBackendItems.filter(
      (item) => canReadQueueItem(item, visibility.records, visibility.viewerId)
    );
    const backendIds = new Set(allBackendItems.map((item) => item.id));
    const legacyItems = readLegacyPlaintextQueue().filter((item) => !backendIds.has(item.id));
    for (const item of legacyItems) {
      if (canReadQueueItem(item, visibility.records, visibility.viewerId))
        await persistProposalItem(item);
    }
    clearLegacyPlaintextQueue();
    set({
      items: [...backendItems, ...legacyItems].filter((item) =>
        canReadQueueItem(item, visibility.records, visibility.viewerId)
      ),
    });
  },

  approve: async (ids, householdKey) => {
    // Sequential: the backend's ~1 rps gate makes parallel sends pointless,
    // and it keeps per-row status updates easy to follow in the UI.
    for (const id of ids) {
      // Policy can change while an earlier row sends; reload before each row.
      const visibility = await refreshVisibilitySnapshot();
      const item = get().items.find((i) => i.id === id);
      if (!item) continue;
      if (!canReadQueueItem(item, visibility.records, visibility.viewerId)) {
        set((state) => ({
          items: state.items.filter((candidate) => candidate.id !== id),
        }));
        throw new Error('This private meeting proposal is not available.');
      }
      await sendOne(item, householdKey);
    }
  },

  dismiss: async (id) => {
    const visibility = await refreshVisibilitySnapshot();
    const item = get().items.find((candidate) => candidate.id === id);
    if (!item || !canReadQueueItem(item, visibility.records, visibility.viewerId)) return;
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
    deleteProposalBestEffort(id);
  },

  updateFinalValue: async (id, finalValue) => {
    const visibility = await refreshVisibilitySnapshot();
    const item = get().items.find((i) => i.id === id);
    if (!item || !canReadQueueItem(item, visibility.records, visibility.viewerId)) return;
    const updated: ProposedCrmWrite = { ...item, finalValue };
    setItem(id, { finalValue });
    persistProposalItemBestEffort(updated);
  },

  setProvenanceIfUnset: async (id, provenance) => {
    const visibility = await refreshVisibilitySnapshot();
    const item = get().items.find((i) => i.id === id);
    if (item && canReadQueueItem(item, visibility.records, visibility.viewerId) && !item.provenance) {
      const updated: ProposedCrmWrite = { ...item, provenance };
      setItem(id, { provenance });
      persistProposalItemBestEffort(updated);
    }
  },

  visibleItemsFresh: async () => {
    const visibility = await refreshVisibilitySnapshot();
    return projectVisibleCrmWriteQueueItems(
      get().items,
      visibility.records,
      visibility.viewerId
    );
  },

  enqueueFieldUpdate: async (args) => {
    // Codex review catch (P2): mirrors the backend's validate_field_is_writable
    // — enqueueing a field the desktop app doesn't accept would show the
    // advisor an approval-ready change that's guaranteed to fail every time.
    if (!isWritableField(args.field)) {
      throw new Error(`"${args.field}" is not a writable Wealthbox field yet.`);
    }
    const finalValue = args.send
      ? await composeFieldBlend({
          field: args.field,
          existingValue: args.existingValue,
          newValue: args.newValue,
          send: args.send,
        })
      : await composeFieldBlend({
          field: args.field,
          existingValue: args.existingValue,
          newValue: args.newValue,
        });
    get().enqueue({
      kind: 'field',
      matterId: args.matterId,
      title: args.title,
      body: '',
      field: args.field,
      existingValue: args.existingValue,
      newValue: args.newValue,
      finalValue,
      sourceRef: args.sourceRef,
    });
  },
}));

useFirmStore.subscribe((state, previous) => {
  const viewerId = state.session?.userId ?? null;
  if (viewerId === (previous.session?.userId ?? null)) return;
  visibilityViewerId = viewerId;
  useCrmWriteQueueStore.setState((queue) => ({
    items: queue.items.filter((item) => canUseVisibleQueueItem(item)),
  }));
});
