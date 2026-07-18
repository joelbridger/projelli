import '@/i18n';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatterHub } from './MatterHub';
import { MattersHome } from './MattersHome';
import {
  issueMatterScopeSelection,
  readAuthoritativeMatterScope,
  requestClearClientSelection,
  requestMatterScopeSelection,
} from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags/router';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';

vi.mock('@/platform/utils/mail-commands', () => ({
  mailListMessages: async () => ({ items: [], total: 0 }),
  mailIsConnected: async () => false,
  gmailIsConnected: async () => false,
  mailImapIsConnected: async () => false,
  mailConnectedAccounts: async () => [],
  mailClearMatterFilings: async () => 0,
}));

vi.mock('@/platform/hooks/useApiKeys', () => ({
  useApiKeys: () => ({ apiKeys: [] }),
}));

vi.mock('@/platform/hooks/useFirm', () => ({
  useFirm: () => ({
    isSignedIn: false,
    hasActiveSeat: false,
    role: null,
    org: null,
    email: null,
    seatId: null,
    entitlement: { aiEnabled: false },
    isOffline: false,
    isLoading: false,
    error: null,
    assuredProviders: [],
    signIn: async () => ({ ok: true }),
    activateSeat: async () => ({ ok: true }),
    signOut: async () => undefined,
  }),
  useAssuredAvailable: () => false,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => { throw new Error('not in test'); }),
  isTauri: () => false,
}));

vi.mock('@/platform/audit/AuditService', () => ({
  AuditService: class { append() {} },
  isAuditEncrypted: () => false,
}));

vi.mock('@/platform/firm/matterKeyService', () => ({
  getOrCreateMatterKey: async () => 'key',
  publishMatterKeyToMembers: async () => ({ published: 0, skippedWalled: 0 }),
  obtainMatterKey: async () => null,
}));

vi.mock('@/platform/firm/deviceKeys', () => ({
  registerDevice: async () => undefined,
  _resetDeviceCache: () => undefined,
  getOrCreateDeviceKeypair: async () => ({ deviceId: 'test', publicJwk: {} }),
}));

vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: async () => vi.fn(),
}));

vi.mock('@/platform/rag/MemoryService', () => ({
  isMemoryEnabled: () => false,
  MemoryService: { retrieve: vi.fn(async () => []) },
}));

vi.mock('@/features/meetings/TodaysMeetingsStrip', () => ({
  TodaysMeetingsStrip: () => null,
}));

vi.mock('@/features/matters/useClientMap', () => ({
  useClientMap: () => ({
    status: 'empty',
    errorMessage: null,
    map: undefined,
    generate: vi.fn(async () => 'unchanged'),
    checkForUpdates: vi.fn(async () => 'unchanged'),
  }),
}));

const alpha: Matter = {
  id: 'matter-alpha',
  name: 'Alpha plan',
  client: 'Alpha household',
  folderPaths: ['/workspace/Alpha'],
  createdAt: '2026-07-18T00:00:00.000Z',
};

function resetDark(): void {
  setDevFlagOverride('selection-authority-boot-gate', false);
  readAuthoritativeMatterScope();
  useMatterStore.setState({
    matters: [alpha],
    activeMatterId: null,
    clientMapHubId: null,
    clientMapHubTab: null,
  });
  requestClearClientSelection();
}

function renderNamedSurfaces(): void {
  render(
    <>
      <MatterHub matterId={alpha.id} onBack={() => undefined} />
      <MattersHome />
    </>,
  );
}

describe('selection presentation on every named T2 surface', () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => {
      resetDark();
    });
  });

  afterEach(() => {
    cleanup();
    act(() => {
      resetDark();
      setDevFlagOverride('selection-authority-boot-gate', undefined);
    });
    if (vi.isFakeTimers()) {
      vi.runAllTimers();
      vi.useRealTimers();
    }
  });

  it('renders a direct BLOCKED marker on MatterHub and MattersHome', () => {
    act(() => {
      useMatterStore.setState({ activeMatterId: 'missing-on-disk' });
      setDevFlagOverride('selection-authority-boot-gate', true);
    });

    renderNamedSurfaces();

    expect(screen.getByTestId('matter-hub-selection-blocked')).toHaveTextContent('BLOCKED');
    expect(screen.getByTestId('matters-home-selection-blocked')).toHaveTextContent('BLOCKED');
  });

  it('renders a direct stale marker on MatterHub and MattersHome', async () => {
    vi.useFakeTimers();
    act(() => {
      setDevFlagOverride('selection-authority-boot-gate', true);
      readAuthoritativeMatterScope();
    });
    await act(async () => {
      await requestMatterScopeSelection(issueMatterScopeSelection(alpha.id));
    });

    renderNamedSurfaces();

    expect(screen.getByTestId('matter-hub-selection-stale')).toHaveTextContent('Selection updating');
    expect(screen.getByTestId('matters-home-selection-stale')).toHaveTextContent('Selection updating');
  });
});
