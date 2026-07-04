// CRM write-back approval queue.
//
// Holds proposed CRM writes (notes/tasks) drafted from a client's note or
// meeting until the advisor explicitly approves them via the review card.
//
// Persisted (zustand + localStorage, same pattern as fileContextStore /
// aiChatStore): "AI proposes, user approves" is the product's core promise —
// a proposal silently vanishing on an app restart breaks it, so un-approved
// proposals must survive. `reconcileRehydratedItems` (below) restores the
// queue honestly instead of trusting it blindly: an item stuck mid-send when
// the app closed had its in-flight call die with it, so it reopens as
// 'proposed' rather than sitting forever disabled; an item whose matter was
// deleted in a prior session is DROPPED rather than kept around forever —
// its only possible display surface is that matter's own (now unreachable)
// MatterHub, so there is nowhere it could ever be reviewed or dismissed; a
// completed ('sent') item is also never persisted forward, since it has
// nothing left to review and the card offers no way to dismiss a done row
// (see `isPersistableStatus`); and structurally corrupt entries are dropped
// rather than throwing later when the UI reads `item.kind` / `item.status`.
//
// The ONLY call sites of `approve()` are the review card's Approve button
// and this file's own tests. Enqueuing never sends anything.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { crmCreateNote, crmCreateTask, crmUpdateField } from '@/platform/utils/wealthbox-commands';
import { composeFieldBlend, isWritableField } from '@/platform/state/fieldBlend';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Provider } from '@/platform/providers/Provider';

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
   * `crm_create_note`'s doc comment in `src-tauri/src/commands/crm/commands.rs`.
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
}

interface CrmWriteQueueState {
  items: ProposedCrmWrite[];
  enqueue: (item: Omit<ProposedCrmWrite, 'id' | 'status'>) => void;
  approve: (ids: string[], householdKey: string) => Promise<void>;
  dismiss: (id: string) => void;
  /** Task 9c: the advisor editing a field item's Blended column. `kind:
   *  'field'` items only — a no-op on any other item. */
  updateFinalValue: (id: string, finalValue: string) => void;
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
      | { provider?: undefined; onBeforeProviderCall?: undefined }
      // Codex review catch (P2): onBeforeProviderCall is REQUIRED whenever a
      // provider is passed — mirrors composeFieldBlend's own constraint, so
      // the required egress-audit hook can't be silently dropped at this
      // (the real) entry point either. See fieldBlend.ts's doc comment.
      | { provider: Provider; onBeforeProviderCall: (prompt: string) => void }
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
  setItemClearingError(item.id, { status: 'sending', requestedAt });
  try {
    const receipt =
      item.kind === 'note'
        ? await crmCreateNote({
            matterId: item.matterId,
            title: item.title,
            body: item.body,
            sourceRef: item.sourceRef,
            householdKey,
            requestedAt,
          })
        : item.kind === 'task'
          ? await crmCreateTask({
              matterId: item.matterId,
              title: item.title,
              description: item.body,
              ...(item.dueDate !== undefined ? { dueDate: item.dueDate } : {}),
              sourceRef: item.sourceRef,
              householdKey,
              requestedAt,
            })
          : await crmUpdateField({
              matterId: item.matterId,
              householdKey,
              field: item.field ?? '',
              existingValue: item.existingValue ?? '',
              newValue: item.newValue ?? '',
              finalValue: item.finalValue ?? '',
              sourceRef: item.sourceRef,
              requestedAt,
            });
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
      setItem(item.id, {
        status: 'stale',
        error: message,
        existingValue: freshExistingValue,
        finalValue: rebuiltFinalValue,
      });
      return;
    }
    const status: CrmWriteStatus = message.includes('verification pending') ? 'verify_pending' : 'failed';
    setItem(item.id, { status, error: message });
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

/** A completed item has nothing left to review or approve — drop it from
 * what gets persisted so it can't come back as a permanent, undismissable
 * "done" card on a future restart (CrmWriteRow renders no Dismiss control
 * for a sent item, since dismissing an in-session confirmation was never a
 * user action worth offering). */
function isPersistableStatus(status: CrmWriteStatus): boolean {
  return status !== 'sent';
}

/**
 * Reconciles a just-rehydrated queue against reality instead of trusting the
 * localStorage snapshot blindly (see the module doc comment above for why).
 * Reads `useMatterStore` directly (a live, already-hydrated read — the
 * static import above guarantees matterStore's own module code, including
 * its own persist rehydration, has already run by the time this executes).
 */
function reconcileRehydratedItems(rawItems: unknown): ProposedCrmWrite[] {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const knownMatterIds = new Set(useMatterStore.getState().matters.map((m) => m.id));
  return items
    .filter(isValidPersistedItem)
    .filter((item) => isPersistableStatus(item.status))
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

export const useCrmWriteQueueStore = create<CrmWriteQueueState>()(
  persist(
    (set, get) => ({
  items: [],

  enqueue: (item) => {
    set((state) => ({
      items: [...state.items, { ...item, id: newId(), status: 'proposed' }],
    }));
  },

  approve: async (ids, householdKey) => {
    // Sequential: the backend's ~1 rps gate makes parallel sends pointless,
    // and it keeps per-row status updates easy to follow in the UI.
    for (const id of ids) {
      const item = get().items.find((i) => i.id === id);
      if (!item) continue;
      await sendOne(item, householdKey);
    }
  },

  dismiss: (id) => {
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
  },

  updateFinalValue: (id, finalValue) => {
    setItem(id, { finalValue });
  },

  enqueueFieldUpdate: async (args) => {
    // Codex review catch (P2): mirrors the backend's validate_field_is_writable
    // — enqueueing a field the desktop app doesn't accept would show the
    // advisor an approval-ready change that's guaranteed to fail every time.
    if (!isWritableField(args.field)) {
      throw new Error(`"${args.field}" is not a writable Wealthbox field yet.`);
    }
    const finalValue = args.provider
      ? await composeFieldBlend({
          field: args.field,
          existingValue: args.existingValue,
          newValue: args.newValue,
          provider: args.provider,
          onBeforeProviderCall: args.onBeforeProviderCall,
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
    }),
    {
      name: 'crm-write-queue-storage',
      version: 1,
      // Codex review catch: never persist a completed ('sent') item forward —
      // it has nothing left to review/approve/dismiss, and would otherwise
      // resurrect as a permanent, undismissable "done" card on Overview
      // after every future restart.
      partialize: (state) => ({ items: state.items.filter((i) => isPersistableStatus(i.status)) }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        items: reconcileRehydratedItems((persistedState as { items?: unknown } | undefined)?.items),
      }),
    },
  ),
);
