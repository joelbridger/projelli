// useSetupProgress — one reactive, unified view of first-run setup progress.
//
// Combines the native backend snapshot (AI/models, email, Wealthbox CRM, file
// indexing — read by `get_setup_progress`) with the Client Map build counts,
// whose truth lives entirely in the frontend stores. It refetches the backend
// snapshot (debounced) whenever any source emits `setup-progress-changed`, and
// pushes the Client Map counts down so a backend snapshot stays complete for any
// non-hook consumer (e.g. a future in-app status view).
//
// Cross-cutting platform hook (mirrors `useRagStatus`): see the data-layer
// contract in `@/platform/utils/setup-progress-commands`.

import { useEffect, useMemo, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  SETUP_PROGRESS_CHANGED_EVENT,
  deriveOverall,
  getSetupProgress,
  reportClientMap,
  type ClientMapProgress,
  type SetupProgress,
} from '@/platform/utils/setup-progress-commands';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import type { Matter } from '@/platform/types/matter';
import type { ClientMap } from '@/platform/clientMap/types';

/** Coalesce bursts of source events (file indexing emits ~2 per file). */
const REFETCH_DEBOUNCE_MS = 150;

/**
 * Count built vs total Client Maps from the frontend stores — the only place
 * this signal's truth lives. Archived and sample matters are excluded.
 * "building" is not globally observable from persisted state (a build is only
 * visible inside its own mounted hook), so it is reported as 0 and the unbuilt
 * remainder is `pending`.
 */
export function computeClientMapProgress(
  matters: Matter[],
  maps: Record<string, ClientMap>,
): ClientMapProgress {
  const relevant = matters.filter((m) => !m.archived && !m.isSample);
  const total = relevant.length;
  const built = relevant.filter((m) => {
    const lastBuiltAt = maps[m.id]?.lastBuiltAt;
    return typeof lastBuiltAt === 'string' && lastBuiltAt !== '';
  }).length;
  return { total, built, building: 0, pending: Math.max(0, total - built) };
}

/**
 * Returns the unified `SetupProgress`, or `null` before the first snapshot
 * arrives (browser/test mode also yields `null`).
 */
export function useSetupProgress(): SetupProgress | null {
  const [snapshot, setSnapshot] = useState<SetupProgress | null>(null);

  // Client Map truth lives in the frontend stores (reactive).
  const matters = useMatterStore((s) => s.matters);
  const maps = useClientMapStore((s) => s.maps);
  const clientMap = useMemo(() => computeClientMapProgress(matters, maps), [matters, maps]);

  // Fetch the backend snapshot once, then refetch (debounced) on every change.
  useEffect(() => {
    if (!isTauri()) return;
    // Mutable holder (not a `let` literal) so the cleanup-closure reassignment
    // is visible to the type-aware lint rules and races are handled correctly.
    const guard = { cancelled: false };
    let unlisten: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refetch = async () => {
      try {
        const next = await getSetupProgress();
        if (!guard.cancelled) setSnapshot(next);
      } catch {
        // Keep the last good snapshot on a transient failure.
      }
    };

    void refetch();

    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const stop = await listen(SETUP_PROGRESS_CHANGED_EVENT, () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void refetch(), REFETCH_DEBOUNCE_MS);
        });
        if (guard.cancelled) stop();
        else unlisten = stop;
      } catch {
        // Event API unavailable (browser/test) — the initial fetch still ran.
      }
    })();

    return () => {
      guard.cancelled = true;
      if (timer) clearTimeout(timer);
      if (unlisten) unlisten();
    };
  }, []);

  // Push the frontend-only Client Map counts down so a backend snapshot is
  // complete for consumers that don't use this hook.
  useEffect(() => {
    if (!isTauri()) return;
    void reportClientMap(clientMap.total, clientMap.built, clientMap.building).catch(() => {
      // Best-effort; the overlay below keeps this hook's value correct anyway.
    });
  }, [clientMap.total, clientMap.built, clientMap.building]);

  // Overlay the live frontend Client Map onto the backend snapshot so the UI is
  // instant and always reflects the stores, then recompute `overall` so it stays
  // consistent with the overlaid counts (the backend snapshot's `overall` may
  // predate the latest Client Map state until a round-trip lands).
  return useMemo(() => {
    if (!snapshot) return null;
    const merged = { ...snapshot, clientMap };
    return { ...merged, overall: deriveOverall(merged) };
  }, [snapshot, clientMap]);
}
