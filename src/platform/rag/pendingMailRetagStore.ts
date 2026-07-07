/**
 * Pending mail re-tag intents (QA-44, Codex round 4) — Zustand, PERSISTED,
 * scoped PER WORKSPACE.
 *
 * When a synced mail folder is re-mapped from one client to another, the folder's
 * already-indexed messages are re-tagged IN PLACE. Until that re-tag SUCCEEDS the
 * messages are still PHYSICALLY tagged with the OLD client, so they must be held
 * out of retrieval (`scopeUpdateStore.excludeMailMatters`) or they surface under
 * the wrong client. That hold used to live ONLY in memory (`scopeUpdateStore` is
 * not persisted), so a workspace close/switch — which disposes the per-workspace
 * retag scheduler — dropped it. On reopen nothing re-established it, and (unlike
 * mapped file folders) the mail could resurface under the old client until some
 * later boot re-tag happened to succeed. That is a cross-SESSION wrong-client
 * mail leak, and it stayed open across any number of failed re-tags.
 *
 * This store is the DURABLE backing for that hold. Each record captures the
 * folder identity, the CURRENT target matter to re-tag to, and the set of STALE
 * matter ids the folder's mail may still be physically tagged as (accumulated
 * across repeated re-maps — see round 2). The invariant it guarantees:
 *
 *   mail physically tagged to a client the UI no longer maps it to MUST NOT
 *   surface until a re-tag to the correct client SUCCEEDS — across sessions,
 *   regardless of how many re-taps fail.
 *
 * Lifecycle (all in `useMemoryWiring`):
 *   - a live re-map with a stale hold RECORDS the intent here (durable) and, on
 *     the re-tag's eventual SUCCESS, CLEARS it;
 *   - on workspace OPEN the recorded intents for THAT workspace are read back and
 *     the `excludeMailMatters` exclusion is re-established FIRST (fail closed),
 *     before the re-tag is re-attempted;
 *   - records are keyed by workspace root, so switching workspaces never bleeds
 *     one workspace's holds into another.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { mailFolderKey } from '@/platform/rag/matterResolver';
import { workspaceScopeId } from '@/platform/state/workspaceScope';

export interface PendingMailRetag {
  /** Workspace root path this intent belongs to (the per-workspace scope key). */
  workspaceRoot: string;
  provider: string;
  account: string;
  folderId: string;
  /** The matter the folder's mail should end up tagged as (the current mapping). */
  targetMatter: string;
  /**
   * Old-client matter ids the folder's mail may STILL be physically tagged as,
   * held out of retrieval until a re-tag to `targetMatter` succeeds. Accumulated
   * across repeated re-maps; never includes `targetMatter`.
   */
  staleMatters: string[];
}

function workspaceKey(workspaceRoot: string): string {
  return workspaceScopeId(workspaceRoot);
}

/** Record key: workspace root + the folder key, so one folder = one live intent. */
function intentKey(workspaceRoot: string, folderKey: string): string {
  return `${workspaceKey(workspaceRoot)}\u0000${folderKey}`;
}

/** QA-44 (R7-6) — structural validation of ONE persisted intent. A record that
 *  fails this (a corrupted/partial `localStorage` blob) is DROPPED rather than
 *  trusted, so a malformed hold can never crash `restoreMailHolds` (e.g. reading
 *  `.length` off a non-array) or restore a garbage exclusion. */
function isPendingMailRetag(v: unknown): v is PendingMailRetag {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['workspaceRoot'] === 'string' &&
    typeof o['provider'] === 'string' &&
    typeof o['account'] === 'string' &&
    typeof o['folderId'] === 'string' &&
    typeof o['targetMatter'] === 'string' &&
    Array.isArray(o['staleMatters']) &&
    o['staleMatters'].every((m) => typeof m === 'string')
  );
}

// QA-44 (R7-6) — set when the persisted store failed to hydrate, or contained
// malformed records that had to be dropped. The restored hold set may then be
// INCOMPLETE, so `restoreMailHolds` surfaces a visible "scope updating" banner and
// lets the idempotent boot retag reconverge — fail closed (a signal + the boot
// heal), never a silent open. Module-level (not store state) so it survives the
// same hydration that may have failed.
let hydrationSuspect = false;

/** QA-44 (R7-6) — true when the durable mail-retag store hydrated incompletely
 *  (corrupt/partial `localStorage`): the restored holds may be missing records. */
export function pendingMailRetagHydrationSuspect(): boolean {
  return hydrationSuspect;
}

/** Test-only reset of the R7-6 hydration-suspect flag. */
export function __resetPendingMailRetagHydrationSuspect(): void {
  hydrationSuspect = false;
}

/** Validate + salvage a persisted state blob: keep every well-formed intent, drop
 *  (and flag) any malformed one, and flag a wholly wrong-shaped blob. Exported for
 *  unit testing the shape gate without touching real `localStorage`. */
export function sanitizePersistedMailRetag(persisted: unknown): {
  intents: Record<string, PendingMailRetag>;
} {
  const validIntents: Record<string, PendingMailRetag> = {};
  const rawIntents =
    persisted && typeof persisted === 'object'
      ? (persisted as { intents?: unknown }).intents
      : undefined;
  if (rawIntents && typeof rawIntents === 'object') {
    for (const value of Object.values(rawIntents as Record<string, unknown>)) {
      if (isPendingMailRetag(value)) mergePendingMailRetag(validIntents, value);
      else hydrationSuspect = true; // a malformed record was dropped
    }
  } else if (persisted !== undefined && persisted !== null) {
    hydrationSuspect = true; // a persisted blob was present but not the expected shape
  }
  return { intents: validIntents };
}

function mergePendingMailRetag(
  intents: Record<string, PendingMailRetag>,
  intent: PendingMailRetag
): void {
  const folderKey = mailFolderKey(
    intent.provider,
    intent.account,
    intent.folderId
  );
  const key = intentKey(intent.workspaceRoot, folderKey);
  const existing = intents[key];
  const stale = new Set(existing?.staleMatters ?? []);
  for (const m of intent.staleMatters) stale.add(m);
  stale.delete(intent.targetMatter); // never hold out the current target
  if (stale.size === 0) {
    Reflect.deleteProperty(intents, key);
    return;
  }
  intents[key] = {
    ...intent,
    workspaceRoot: workspaceKey(intent.workspaceRoot),
    staleMatters: [...stale],
  };
}

interface PendingMailRetagState {
  intents: Record<string, PendingMailRetag>;
  /**
   * Upsert an intent. `staleMatters` is UNIONED with any existing record for the
   * same folder (durable accumulation), and `targetMatter` is updated to the
   * latest mapping. Passing an empty union with no prior record is a no-op.
   */
  record: (intent: PendingMailRetag) => void;
  /** Drop the intent for a folder (on a successful re-tag, or when it no longer
   *  needs a hold). */
  clear: (workspaceRoot: string, folderKey: string) => void;
  /** Every intent recorded for a workspace root. */
  forWorkspace: (workspaceRoot: string) => PendingMailRetag[];
}

export const usePendingMailRetagStore = create<PendingMailRetagState>()(
  persist(
    (set, get) => ({
      intents: {},

      record: (intent) => {
        const folderKey = mailFolderKey(
          intent.provider,
          intent.account,
          intent.folderId
        );
        const key = intentKey(intent.workspaceRoot, folderKey);
        const existing = get().intents[key];
        const stale = new Set(existing?.staleMatters ?? []);
        for (const m of intent.staleMatters) stale.add(m);
        stale.delete(intent.targetMatter); // never hold out the current target
        if (stale.size === 0) {
          // Nothing to hold out — don't keep an empty record around.
          if (!existing) return;
          set((state) => ({
            intents: Object.fromEntries(
              Object.entries(state.intents).filter(([k]) => k !== key)
            ),
          }));
          return;
        }
        set((state) => ({
          intents: {
            ...state.intents,
            [key]: {
              ...intent,
              workspaceRoot: workspaceKey(intent.workspaceRoot),
              staleMatters: [...stale],
            },
          },
        }));
      },

      clear: (workspaceRoot, folderKey) => {
        const key = intentKey(workspaceRoot, folderKey);
        const canonicalRoot = workspaceKey(workspaceRoot);
        const shouldDrop = ([k, intent]: [string, PendingMailRetag]) =>
          k === key ||
          (workspaceKey(intent.workspaceRoot) === canonicalRoot &&
            mailFolderKey(intent.provider, intent.account, intent.folderId) ===
              folderKey);
        if (!Object.entries(get().intents).some(shouldDrop)) return;
        set((state) => ({
          intents: Object.fromEntries(
            Object.entries(state.intents).filter((entry) => !shouldDrop(entry))
          ),
        }));
      },

      forWorkspace: (workspaceRoot) =>
        Object.values(get().intents).filter(
          (i) => workspaceKey(i.workspaceRoot) === workspaceKey(workspaceRoot)
        ),
    }),
    {
      name: 'lantern:pending-mail-retag',
      version: 1,
      // QA-44 (R7-6): validate the persisted shape on hydration. A corrupt/partial
      // blob keeps its well-formed records (still held) and drops malformed ones,
      // marking the store SUSPECT so `restoreMailHolds` surfaces a banner — never
      // trusting a garbage record and never silently failing open.
      merge: (persisted, current) => ({
        ...current,
        ...sanitizePersistedMailRetag(persisted),
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) hydrationSuspect = true;
      },
    }
  )
);
