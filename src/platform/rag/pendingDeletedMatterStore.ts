import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { workspaceScopeId } from '@/platform/state/workspaceScope';
import { ragDeleteMatter } from '@/platform/utils/tauri-commands';
import { mailClearMatterFilings } from '@/platform/utils/mail-commands';

function workspaceKey(workspaceRoot: string): string {
  return workspaceScopeId(workspaceRoot);
}

function uniqueMatterIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
}

function equivalentWorkspaceEntries(
  deletedByWorkspace: Record<string, string[]>,
  workspaceRoot: string,
): Array<[string, string[]]> {
  const key = workspaceKey(workspaceRoot);
  return Object.entries(deletedByWorkspace).filter(([k]) => workspaceKey(k) === key);
}

function isMatterIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string');
}

let hydrationSuspect = false;

export function pendingDeletedMatterHydrationSuspect(): boolean {
  return hydrationSuspect;
}

export function __resetPendingDeletedMatterHydrationSuspect(): void {
  hydrationSuspect = false;
}

export function sanitizePersistedDeletedMatters(persisted: unknown): {
  deletedByWorkspace: Record<string, string[]>;
} {
  const valid: Record<string, string[]> = {};
  const raw =
    persisted && typeof persisted === 'object'
      ? (persisted as { deletedByWorkspace?: unknown }).deletedByWorkspace
      : undefined;
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (isMatterIdList(value)) {
        const ids = uniqueMatterIds(value);
        if (ids.length > 0) valid[workspaceKey(key)] = ids;
      } else {
        hydrationSuspect = true;
      }
    }
  } else if (persisted !== undefined && persisted !== null) {
    hydrationSuspect = true;
  }
  return { deletedByWorkspace: valid };
}

interface PendingDeletedMatterState {
  deletedByWorkspace: Record<string, string[]>;
  record: (workspaceRoot: string, matterId: string) => void;
  clear: (workspaceRoot: string, matterId: string) => void;
  forWorkspace: (workspaceRoot: string) => string[];
}

export const usePendingDeletedMatterStore = create<PendingDeletedMatterState>()(
  persist(
    (set, get) => ({
      deletedByWorkspace: {},

      record: (workspaceRoot, matterId) => {
        if (!workspaceRoot || !matterId) return;
        const key = workspaceKey(workspaceRoot);
        const existing = equivalentWorkspaceEntries(
          get().deletedByWorkspace,
          workspaceRoot,
        ).flatMap(([, ids]) => ids);
        const next = uniqueMatterIds([...existing, matterId]);
        if (
          existing.length === next.length &&
          get().deletedByWorkspace[key]?.length === next.length
        ) {
          return;
        }
        set((state) => ({
          deletedByWorkspace: {
            ...Object.fromEntries(
              Object.entries(state.deletedByWorkspace).filter(
                ([k]) => workspaceKey(k) !== key,
              ),
            ),
            [key]: next,
          },
        }));
      },

      clear: (workspaceRoot, matterId) => {
        if (!workspaceRoot || !matterId) return;
        const key = workspaceKey(workspaceRoot);
        const existing = equivalentWorkspaceEntries(
          get().deletedByWorkspace,
          workspaceRoot,
        ).flatMap(([, ids]) => ids);
        if (existing.length === 0 || !existing.includes(matterId)) return;
        const remaining = uniqueMatterIds(existing.filter((id) => id !== matterId));
        set((state) => ({
          deletedByWorkspace:
            remaining.length === 0
              ? Object.fromEntries(
                  Object.entries(state.deletedByWorkspace).filter(
                    ([k]) => workspaceKey(k) !== key,
                  ),
                )
              : {
                  ...Object.fromEntries(
                    Object.entries(state.deletedByWorkspace).filter(
                      ([k]) => workspaceKey(k) !== key,
                    ),
                  ),
                  [key]: remaining,
                },
        }));
      },

      forWorkspace: (workspaceRoot) =>
        uniqueMatterIds(
          equivalentWorkspaceEntries(
            get().deletedByWorkspace,
            workspaceRoot,
          ).flatMap(([, ids]) => ids),
        ),
    }),
    {
      name: 'lantern:pending-deleted-matters',
      version: 1,
      merge: (persisted, current) => ({
        ...current,
        ...sanitizePersistedDeletedMatters(persisted),
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) hydrationSuspect = true;
      },
    },
  ),
);

export async function purgeDeletedMatterForWorkspace(
  workspaceRoot: string,
  matterId: string,
): Promise<boolean> {
  if (!workspaceRoot || !matterId) return false;
  try {
    await ragDeleteMatter(matterId);
    await mailClearMatterFilings(matterId);
  } catch (err) {
    console.warn('[memory] deleted matter purge failed; will retry on next boot:', err);
    return false;
  }
  usePendingDeletedMatterStore.getState().clear(workspaceRoot, matterId);
  return true;
}

export async function purgePendingDeletedMattersForWorkspace(
  workspaceRoot: string | null | undefined,
): Promise<void> {
  if (!workspaceRoot) return;
  const matterIds = usePendingDeletedMatterStore.getState().forWorkspace(workspaceRoot);
  for (const matterId of matterIds) {
    await purgeDeletedMatterForWorkspace(workspaceRoot, matterId);
  }
}
