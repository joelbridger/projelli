// src/features/matters/useClientMap.ts
import { useCallback, useEffect, useState } from 'react';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { buildClientMap } from '@/platform/clientMap/generator';
import { computeSourceFingerprint, proposeUpdates, mergePendingUpdates } from '@/platform/clientMap/updater';
import type { ClientMap } from '@/platform/clientMap/types';
import type { AuditEntry } from '@/platform/types/audit';

export type ClientMapStatus = 'idle' | 'generating' | 'ready' | 'empty' | 'error';

/** Matters whose Client Map build is currently in flight. Shared across all hook
 *  instances so the auto-build effect and the manual build can't fire two
 *  concurrent builds for the same matter — a React StrictMode double-invoke (dev)
 *  or a fast manual click otherwise spends duplicate AI cost + audit entries. */
const clientMapBuildsInFlight = new Set<string>();

/** A stored map is "ready" if it holds something to show: a section item, a
 *  pending update, or an open gap question (which the Guided Interview works
 *  through). A truly empty stored object surfaces the honest empty state
 *  (BUG-103); a gap-only map is NOT empty, so the interview can render (Codex
 *  finding 4). */
function mapHasContent(map: ClientMap | undefined): boolean {
  if (!map) return false;
  return (
    map.sections.some((s) => s.items.length > 0) ||
    map.pendingUpdates.length > 0 ||
    map.completeness.ask.length > 0 ||
    map.sections.some((s) => s.kind === 'custom') // a user-added section is real content
  );
}

/** Any state a regenerate must NOT blow away. Broader than mapHasContent: it
 *  also covers recorded resolved gaps and prior dismissals, so an AI rebuild
 *  never silently wipes the professional's decisions (BUG-101 airtight; Codex
 *  finding 1). */
function mapHasPreservableState(map: ClientMap | undefined): boolean {
  if (!map) return false;
  return (
    mapHasContent(map) ||
    (map.resolvedGaps?.length ?? 0) > 0 ||
    (map.dismissedSignatures?.length ?? 0) > 0
  );
}

export function useClientMap(
  matterId: string,
  options?: {
    onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
    /**
     * When true, automatically build the map the first time a matter is opened
     * with no map yet (status 'idle'), so a connector-created client — or any
     * client — shows a populated, cited map with NO manual "Open Client Map"
     * step. Mirrors the Matter-at-a-Glance auto-run on open. Cheap for
     * content-less matters (buildClientMap short-circuits before any AI call)
     * and runs at most once (the result is cached; status leaves 'idle' after
     * the first build, and a build error lands on 'error', not back on 'idle',
     * so it never retry-loops).
     */
    autoBuild?: boolean;
  },
): {
  status: ClientMapStatus; map: ClientMap | undefined; generate: () => Promise<void>; checkForUpdates: () => Promise<void>;
} {
  const map = useClientMapStore((s) => s.maps[matterId]);
  const setMap = useClientMapStore((s) => s.setMap);
  const onAuditLog = options?.onAuditLog;
  const [status, setStatus] = useState<ClientMapStatus>(mapHasContent(map) ? 'ready' : map ? 'empty' : 'idle');
  const generate = useCallback(async () => {
    // Dedupe concurrent builds for the same matter (auto-build vs manual click,
    // StrictMode double-invoke). A build already in flight wins; this call no-ops.
    if (clientMapBuildsInFlight.has(matterId)) return;
    clientMapBuildsInFlight.add(matterId);
    setStatus('generating');
    try {
      const built = await buildClientMap(
        matterId,
        onAuditLog ? { onAuditLog } : undefined,
      );
      const fp = await computeSourceFingerprint(matterId);

      const existing = useClientMapStore.getState().getMap(matterId);

      if (mapHasPreservableState(existing) && existing !== undefined) {
        // A map already exists with the professional's own work (user-origin
        // items, accepted updates, custom sections, resolved gaps, dismissals).
        // NEVER blindly overwrite it. Route fresh AI content through the
        // approve-first tray instead, and keep the existing map intact.
        const dismissed = existing.dismissedSignatures ?? [];
        const proposals = proposeUpdates(matterId, existing, built, dismissed, fp);
        const nextMap = {
          ...existing,
          pendingUpdates: mergePendingUpdates(existing.pendingUpdates, proposals, dismissed),
          lastSourceFingerprint: fp,
        };
        useClientMapStore.getState().setMap(matterId, nextMap);
        // Clear the transient 'generating'; the returned status is re-derived
        // from the stored map's actual content below.
        setStatus(mapHasContent(nextMap) ? 'ready' : 'empty');
        return;
      }

      // First build (or a previously-empty map): full store is safe.
      const builtMap = { ...built, lastSourceFingerprint: fp };
      setMap(matterId, builtMap);
      setStatus(mapHasContent(builtMap) ? 'ready' : 'empty');
    } catch {
      setStatus('error');
    } finally {
      clientMapBuildsInFlight.delete(matterId);
    }
  }, [matterId, setMap, onAuditLog]);

  const checkForUpdates = useCallback(async () => {
    const current = useClientMapStore.getState().getMap(matterId);
    if (!current || current.lastBuiltAt === '') return;
    const fp = await computeSourceFingerprint(matterId);
    if (fp === current.lastSourceFingerprint) return;
    const fresh = await buildClientMap(
      matterId,
      onAuditLog ? { onAuditLog } : undefined,
    );
    const dismissed = current.dismissedSignatures ?? [];
    const proposals = proposeUpdates(matterId, current, fresh, dismissed);
    // NEVER replace items, and NEVER silently drop a still-pending proposal the
    // user hasn't reviewed (BUG-104): merge the fresh proposals into the existing
    // tray by stable signature. Keep current sections; only update the fingerprint.
    useClientMapStore.getState().setMap(matterId, {
      ...current,
      pendingUpdates: mergePendingUpdates(current.pendingUpdates, proposals, dismissed),
      lastSourceFingerprint: fp,
    });
  }, [matterId, onAuditLog]);

  // Transient/terminal states from an in-flight or failed generate win; otherwise
  // derive from the stored map's actual content so an empty matter shows the
  // honest empty state instead of a blank "ready" map (BUG-103).
  const resolvedStatus: ClientMapStatus =
    status === 'generating' || status === 'error'
      ? status
      : mapHasContent(map)
        ? 'ready'
        : map
          ? 'empty'
          : status;

  // Auto-build on first open (opt-in). 'idle' means no map is stored yet, so this
  // fires once per matter the first time it is viewed, then never again (the
  // build moves status off 'idle' and the result is cached). See the autoBuild
  // option doc above for why this is safe + cheap.
  const autoBuild = options?.autoBuild ?? false;
  useEffect(() => {
    if (autoBuild && resolvedStatus === 'idle') {
      // Defer out of the synchronous effect body so generate()'s initial
      // setStatus('generating') doesn't run synchronously inside the effect
      // (avoids cascading renders — same pattern the at-a-glance auto-run uses).
      void Promise.resolve().then(() => { void generate(); });
    }
  }, [autoBuild, resolvedStatus, generate]);

  return { status: resolvedStatus, map, generate, checkForUpdates };
}
