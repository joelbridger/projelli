// tests/unit/matters/useClientMap.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const buildMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/clientMap/generator', () => ({ buildClientMap: buildMock }));

import { useClientMap } from '@/features/matters/useClientMap';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';

beforeEach(() => { useClientMapStore.setState({ maps: {} }); buildMock.mockReset(); });

describe('useClientMap', () => {
  it('serves a cached map immediately as ready', () => {
    useClientMapStore.getState().setMap('m1', { ...emptyClientMap('m1'), lastBuiltAt: 't' });
    const { result } = renderHook(() => useClientMap('m1'));
    expect(result.current.status).toBe('ready');
  });

  it('generate() builds, stores, and becomes ready', async () => {
    const built = { ...emptyClientMap('m1'), lastBuiltAt: 't' };
    built.sections[0]!.items.push({ id: 'i', text: 'x', origin: 'ai', isAssumption: false, sources: [{ kind: 'document', ref: '/f', snippet: 's' }], updatedAt: 't' });
    buildMock.mockResolvedValue(built);
    const { result } = renderHook(() => useClientMap('m1'));
    await act(async () => { await result.current.generate(); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(useClientMapStore.getState().getMap('m1')?.sections[0]?.items.length).toBe(1);
  });
});
