// src/features/matters/useClientMap.ts
import { useCallback, useState } from 'react';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { buildClientMap } from '@/platform/clientMap/generator';
import type { ClientMap } from '@/platform/clientMap/types';

export type ClientMapStatus = 'idle' | 'generating' | 'ready' | 'empty' | 'error';

export function useClientMap(matterId: string): {
  status: ClientMapStatus; map: ClientMap | undefined; generate: () => Promise<void>;
} {
  const map = useClientMapStore((s) => s.maps[matterId]);
  const setMap = useClientMapStore((s) => s.setMap);
  const [status, setStatus] = useState<ClientMapStatus>(map ? 'ready' : 'idle');
  const generate = useCallback(async () => {
    setStatus('generating');
    try {
      const built = await buildClientMap(matterId);
      setMap(matterId, built);
      const hasContent = built.sections.some((s) => s.items.length > 0);
      setStatus(hasContent ? 'ready' : 'empty');
    } catch {
      setStatus('error');
    }
  }, [matterId, setMap]);
  return { status: map ? 'ready' : status, map, generate };
}
