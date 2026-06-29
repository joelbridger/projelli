// tests/unit/matters/useClientMap.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const buildMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/clientMap/generator', () => ({ buildClientMap: buildMock }));

const computeFingerprintMock = vi.hoisted(() => vi.fn());
const proposeUpdatesMock = vi.hoisted(() => vi.fn());
vi.mock('@/platform/clientMap/updater', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/clientMap/updater')>();
  return {
    ...actual, // keep the real mergePendingUpdates (pure, store-free)
    computeSourceFingerprint: computeFingerprintMock,
    proposeUpdates: proposeUpdatesMock,
  };
});

import { useClientMap } from '@/features/matters/useClientMap';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { ProposedUpdate } from '@/platform/clientMap/types';
import { ConfidentialityChoiceRequiredError } from '@/platform/privacy/localOnlyGuard';

beforeEach(() => {
  useClientMapStore.setState({ maps: {} });
  buildMock.mockReset();
  computeFingerprintMock.mockReset();
  proposeUpdatesMock.mockReset();
});

describe('useClientMap', () => {
  it('serves a cached map immediately as ready', () => {
    // A cached map WITH content mounts as ready without re-generating.
    // (An empty cached map surfaces the honest empty state — see BUG-103.)
    const cached = { ...emptyClientMap('m1'), lastBuiltAt: 't' };
    cached.sections[0]!.items = [
      { id: 'i', text: 'Matter overview', origin: 'ai', isAssumption: false, sources: [{ kind: 'document', ref: '/f', snippet: 's' }], updatedAt: 't' },
    ];
    useClientMapStore.getState().setMap('m1', cached);
    const { result } = renderHook(() => useClientMap('m1'));
    expect(result.current.status).toBe('ready');
  });

  it('generate() builds, stores, and becomes ready', async () => {
    const built = { ...emptyClientMap('m1'), lastBuiltAt: 't' };
    built.sections[0]!.items.push({ id: 'i', text: 'x', origin: 'ai', isAssumption: false, sources: [{ kind: 'document', ref: '/f', snippet: 's' }], updatedAt: 't' });
    buildMock.mockResolvedValue(built);
    computeFingerprintMock.mockResolvedValue('fp-initial');
    const { result } = renderHook(() => useClientMap('m1'));
    await act(async () => { await result.current.generate(); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(useClientMapStore.getState().getMap('m1')?.sections[0]?.items.length).toBe(1);
    // generate() should also record the source fingerprint
    expect(useClientMapStore.getState().getMap('m1')?.lastSourceFingerprint).toBe('fp-initial');
  });

  it('checkForUpdates with a changed fingerprint sets pendingUpdates and keeps existing items', async () => {
    // Seed a built map with a known fingerprint and an existing item
    const initial = { ...emptyClientMap('m2'), lastBuiltAt: '2026-01-01T00:00:00.000Z', lastSourceFingerprint: 'fp-old' };
    initial.sections[0]!.items.push({ id: 'existing-item', text: 'Keep me', origin: 'user', isAssumption: false, sources: [], updatedAt: '2026-01-01T00:00:00.000Z' });
    useClientMapStore.getState().setMap('m2', initial);

    // Mock: fingerprint changed, fresh build returns something, proposals are returned
    computeFingerprintMock.mockResolvedValue('fp-new');
    const freshMap = { ...emptyClientMap('m2'), lastBuiltAt: '2026-01-02T00:00:00.000Z' };
    buildMock.mockResolvedValue(freshMap);
    const mockProposals: ProposedUpdate[] = [
      { id: 'proposal-1', sectionKey: 'goals', op: 'add', reason: 'New doc', createdAt: new Date().toISOString(),
        draft: { id: 'new-item', text: 'New info', origin: 'ai', isAssumption: false, sources: [], updatedAt: new Date().toISOString() } },
    ];
    proposeUpdatesMock.mockReturnValue(mockProposals);

    const { result } = renderHook(() => useClientMap('m2'));
    await act(async () => { await result.current.checkForUpdates(); });

    const stored = useClientMapStore.getState().getMap('m2');
    // pendingUpdates should be the mocked proposals
    expect(stored?.pendingUpdates).toEqual(mockProposals);
    // Existing items must NOT be replaced
    expect(stored?.sections[0]?.items.some((it) => it.id === 'existing-item')).toBe(true);
    // Fingerprint updated
    expect(stored?.lastSourceFingerprint).toBe('fp-new');
  });

  it('checkForUpdates with an unchanged fingerprint is a no-op', async () => {
    const initial = { ...emptyClientMap('m3'), lastBuiltAt: '2026-01-01T00:00:00.000Z', lastSourceFingerprint: 'fp-same', pendingUpdates: [] };
    useClientMapStore.getState().setMap('m3', initial);

    computeFingerprintMock.mockResolvedValue('fp-same'); // same fingerprint
    buildMock.mockResolvedValue({ ...emptyClientMap('m3') });
    proposeUpdatesMock.mockReturnValue([]);

    const { result } = renderHook(() => useClientMap('m3'));
    await act(async () => { await result.current.checkForUpdates(); });

    // buildClientMap should NOT have been called (early return on matching fingerprint)
    expect(buildMock).not.toHaveBeenCalled();
    // pendingUpdates stays empty
    expect(useClientMapStore.getState().getMap('m3')?.pendingUpdates).toEqual([]);
  });

  it('logs and surfaces the confidentiality-choice action instead of the generic AI-connection error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    computeFingerprintMock.mockResolvedValue('fp-initial');
    buildMock.mockRejectedValue(new ConfidentialityChoiceRequiredError());

    const { result } = renderHook(() => useClientMap('m4'));
    await act(async () => { await result.current.generate(); });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toMatch(/Settings.*Privacy|Privacy.*choose/i);
    expect(result.current.errorMessage).not.toMatch(/AI connection/i);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Client Map build failed/i),
      expect.any(ConfidentialityChoiceRequiredError),
    );

    consoleErrorSpy.mockRestore();
  });

  it('checkForUpdates logs and surfaces a confidentiality-choice error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const initial = {
      ...emptyClientMap('m5'),
      lastBuiltAt: '2026-01-01T00:00:00.000Z',
      lastSourceFingerprint: 'fp-old',
      pendingUpdates: [],
    };
    initial.sections[0]!.items.push({
      id: 'existing-item',
      text: 'Keep me',
      origin: 'user',
      isAssumption: false,
      sources: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    useClientMapStore.getState().setMap('m5', initial);

    const choiceError = new ConfidentialityChoiceRequiredError();
    choiceError.message = 'Open Settings > Privacy and choose how cloud AI requests should work.';
    computeFingerprintMock.mockResolvedValue('fp-new');
    buildMock.mockRejectedValue(choiceError);

    const { result } = renderHook(() => useClientMap('m5'));
    await act(async () => { await result.current.checkForUpdates(); });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorMessage).toMatch(/Settings.*Privacy|Privacy.*choose/i);
    expect(result.current.errorMessage).not.toMatch(/Before sending to a cloud AI/i);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Client Map update check failed/i),
      expect.any(ConfidentialityChoiceRequiredError),
    );

    consoleErrorSpy.mockRestore();
  });
});
