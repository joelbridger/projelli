// src/features/matters/useClientMap.ts
import { useCallback, useState } from 'react';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { buildClientMap } from '@/platform/clientMap/generator';
import { computeSourceFingerprint, proposeUpdates } from '@/platform/clientMap/updater';
import type { ClientMap } from '@/platform/clientMap/types';

export type ClientMapStatus = 'idle' | 'generating' | 'ready' | 'empty' | 'error';

export function useClientMap(matterId: string): {
  status: ClientMapStatus; map: ClientMap | undefined; generate: () => Promise<void>; checkForUpdates: () => Promise<void>;
} {
  const map = useClientMapStore((s) => s.maps[matterId]);
  const setMap = useClientMapStore((s) => s.setMap);
  const [status, setStatus] = useState<ClientMapStatus>(map ? 'ready' : 'idle');
  const generate = useCallback(async () => {
    setStatus('generating');
    try {
      const built = await buildClientMap(matterId);
      const fp = await computeSourceFingerprint(matterId);
      setMap(matterId, { ...built, lastSourceFingerprint: fp });
      const hasContent = built.sections.some((s) => s.items.length > 0);
      setStatus(hasContent ? 'ready' : 'empty');
    } catch {
      setStatus('error');
    }
  }, [matterId, setMap]);

  const checkForUpdates = useCallback(async () => {
    const current = useClientMapStore.getState().getMap(matterId);
    if (!current || current.lastBuiltAt === '') return;
    const fp = await computeSourceFingerprint(matterId);
    if (fp === current.lastSourceFingerprint) return;
    const fresh = await buildClientMap(matterId);
    const proposals = proposeUpdates(matterId, current, fresh);
    // NEVER replace items: keep current sections, only add proposals + update the fingerprint
    useClientMapStore.getState().setMap(matterId, { ...current, pendingUpdates: proposals, lastSourceFingerprint: fp });
  }, [matterId]);

  return { status: map ? 'ready' : status, map, generate, checkForUpdates };
}
