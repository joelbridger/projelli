/**
 * Phase A — Local-only kill-switch: useModelList must not call provider model-list
 * APIs in Local-only mode (those send the API key off-device). It falls back to
 * the built-in default lists instead.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const getModelsMock = vi.hoisted(() => vi.fn(async () => [{ id: 'live-model', name: 'Live' }]));
const refreshMock = vi.hoisted(() => vi.fn(async () => [{ id: 'refreshed', name: 'Refreshed' }]));
vi.mock('@/platform/providers/ModelListService', () => ({
  getModels: getModelsMock,
  refreshModels: refreshMock,
  clearModelCache: vi.fn(),
  getDefaultModels: (p: string) => [{ id: `${p}-default`, name: `${p} default` }],
}));

import { useModelList } from '@/platform/hooks/useModelList';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';

function setMode(mode: string) {
  act(() => {
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, mode);
  });
}

const KEYS = [{ provider: 'anthropic' as const, key: 'sk-ant-test' }];

beforeEach(() => {
  useSettingsStore.setState({ values: {} });
  getModelsMock.mockClear();
  refreshMock.mockClear();
});

describe('useModelList Local-only kill-switch', () => {
  it('does NOT call the provider model-list API in Local-only (uses defaults)', async () => {
    setMode('local-only');
    const { result } = renderHook(() => useModelList(KEYS));
    await act(async () => {});
    expect(getModelsMock).not.toHaveBeenCalled();
    // Falls back to the built-in default list, no network.
    expect(result.current.models.anthropic).toEqual([{ id: 'anthropic-default', name: 'anthropic default' }]);
    expect(result.current.isLoading).toBe(false);
  });

  it('DOES call the provider model-list API when not in Local-only', async () => {
    setMode('direct');
    renderHook(() => useModelList(KEYS));
    await waitFor(() => expect(getModelsMock).toHaveBeenCalledWith('anthropic', 'sk-ant-test'));
  });

  it('manual refreshProvider does NOT hit the network in Local-only', async () => {
    setMode('local-only');
    const { result } = renderHook(() => useModelList(KEYS));
    await act(async () => {});
    await act(async () => {
      await result.current.refreshProvider('anthropic', 'sk-ant-test');
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
