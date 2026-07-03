// CRM write-back approval queue.
//
// Holds proposed CRM writes (notes/tasks) drafted from a client's note or
// meeting until the advisor explicitly approves them via the review card.
// No persistence: proposals are session-scoped by design — a restart clears
// un-approved proposals, which is the safe default (nothing half-sent
// survives a crash into a new session unexpectedly).
//
// The ONLY call sites of `approve()` are the review card's Approve button
// and this file's own tests. Enqueuing never sends anything.

import { create } from 'zustand';

import { crmCreateNote, crmCreateTask } from '@/platform/utils/wealthbox-commands';

export type CrmWriteStatus = 'proposed' | 'sending' | 'sent' | 'failed' | 'verify_pending';

export interface ProposedCrmWrite {
  id: string;
  kind: 'note' | 'task';
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
}

interface CrmWriteQueueState {
  items: ProposedCrmWrite[];
  enqueue: (item: Omit<ProposedCrmWrite, 'id' | 'status'>) => void;
  approve: (ids: string[], householdKey: string) => Promise<void>;
  dismiss: (id: string) => void;
}

function newId(): string {
  return `crmw-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
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

async function sendOne(item: ProposedCrmWrite, householdKey: string): Promise<void> {
  // Set once, on this item's FIRST send attempt, then reused verbatim on
  // every retry (approve() re-fetches the item fresh from the store each
  // time it's called, so a manual Retry sees the value persisted below).
  // Never regenerated per attempt — that would defeat the backend's
  // retry-vs-fresh-approval dedup guarantee (see the field's doc comment).
  const requestedAt = item.requestedAt ?? new Date().toISOString();
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
        : await crmCreateTask({
            matterId: item.matterId,
            title: item.title,
            description: item.body,
            ...(item.dueDate !== undefined ? { dueDate: item.dueDate } : {}),
            sourceRef: item.sourceRef,
            householdKey,
            requestedAt,
          });
    setItemClearingError(item.id, { status: 'sent', remoteId: receipt.remoteId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status: CrmWriteStatus = message.includes('verification pending') ? 'verify_pending' : 'failed';
    setItem(item.id, { status, error: message });
  }
}

export const useCrmWriteQueueStore = create<CrmWriteQueueState>((set, get) => ({
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
}));
