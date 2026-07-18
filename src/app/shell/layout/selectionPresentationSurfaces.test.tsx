import '@/i18n';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  issueMatterScopeSelection,
  readAuthoritativeMatterScope,
  requestClearClientSelection,
  requestMatterScopeSelection,
} from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags/router';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';
import { Spine } from './Spine';
import { StatusBar } from './StatusBar';
import { TrustBar } from './TrustBar';

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
  useMatterStore.setState({ matters: [alpha], activeMatterId: null });
  requestClearClientSelection();
}

function renderShellSurfaces(): void {
  render(
    <>
      <TrustBar />
      <StatusBar />
      <Spine />
    </>,
  );
}

describe('selection presentation on the named shell T2 surfaces', () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => {
      resetDark();
    });
  });

  afterEach(() => {
    act(() => {
      resetDark();
      setDevFlagOverride('selection-authority-boot-gate', undefined);
    });
    if (vi.isFakeTimers()) {
      vi.runAllTimers();
      vi.useRealTimers();
    }
  });

  it('renders a direct BLOCKED marker on TrustBar, StatusBar, and Spine', () => {
    act(() => {
      useMatterStore.setState({ activeMatterId: 'missing-on-disk' });
      setDevFlagOverride('selection-authority-boot-gate', true);
    });

    renderShellSurfaces();

    expect(screen.getByTestId('trust-bar-selection-blocked')).toHaveTextContent('BLOCKED');
    expect(screen.getByTestId('status-bar-selection-blocked')).toHaveTextContent('BLOCKED');
    expect(screen.getByTestId('spine-selection-blocked')).toHaveTextContent('BLOCKED');
  });

  it('renders a direct stale marker on TrustBar, StatusBar, and Spine', async () => {
    act(() => {
      setDevFlagOverride('selection-authority-boot-gate', true);
      readAuthoritativeMatterScope();
    });
    await act(async () => {
      await requestMatterScopeSelection(issueMatterScopeSelection(alpha.id));
    });

    renderShellSurfaces();

    expect(screen.getByTestId('trust-bar-selection-stale')).toHaveTextContent('Selection updating');
    expect(screen.getByTestId('status-bar-selection-stale')).toHaveTextContent('Selection updating');
    expect(screen.getByTestId('spine-selection-stale')).toHaveTextContent('Selection updating');
  });
});
