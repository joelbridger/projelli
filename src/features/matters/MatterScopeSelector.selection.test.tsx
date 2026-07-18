import '@/i18n';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatterScopeSelector } from './MatterScopeSelector';
import { setDevFlagOverride } from '@/platform/flags/router';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';
import {
  issueMatterScopeSelection,
  issueAllMattersScopeSelection,
  readAuthoritativeMatterScope,
  requestClearClientSelection,
  requestMatterScopeSelection,
  resolveSelectionPresentation,
} from '@/platform/client-context';

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
  useMatterStore.setState({ matters: [], activeMatterId: null });
  requestClearClientSelection();
}

describe('selection T2 presentation', () => {
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
    localStorage.clear();
    if (vi.isFakeTimers()) {
      vi.runAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps the inert flag-off presentation byte-identical to the legacy follower', () => {
    act(() => {
      useMatterStore.setState({ matters: [alpha], activeMatterId: alpha.id });
    });
    render(<MatterScopeSelector />);

    const trigger = screen.getByTestId('matter-scope-selector');
    expect(trigger).toHaveAttribute('data-scope', 'matter');
    expect(trigger).not.toHaveAttribute('data-source-scope');
    expect(trigger).not.toHaveAttribute('data-follower-status');
    expect(trigger).toHaveTextContent('Alpha');
    expect(trigger).not.toHaveTextContent('BLOCKED');
    expect(trigger).not.toHaveTextContent('Updating');
  });

  it('keeps the legacy all-matters selector attribute spelling while the flag is off', () => {
    render(<MatterScopeSelector />);

    const trigger = screen.getByTestId('matter-scope-selector');
    expect(trigger).toHaveAttribute('data-scope', 'allMatters');
    expect(trigger).not.toHaveAttribute('data-source-scope');
    expect(trigger).not.toHaveAttribute('data-follower-status');
  });

  it('boot-validation-failure-renders-BLOCKED', () => {
    act(() => {
      useMatterStore.setState({ matters: [], activeMatterId: 'missing-on-disk' });
      setDevFlagOverride('selection-authority-boot-gate', true);
    });

    render(<MatterScopeSelector />);

    const trigger = screen.getByTestId('matter-scope-selector');
    expect(readAuthoritativeMatterScope()).toEqual({ kind: 'blocked-unresolved' });
    expect(trigger).toHaveAttribute('data-scope', 'blocked-unresolved');
    expect(trigger).toHaveTextContent('BLOCKED');
    expect(trigger).not.toHaveTextContent(/All (matters|clients)/i);
  });

  it('visibly marks stale source projection without changing the source arm', async () => {
    vi.useFakeTimers();
    act(() => {
      useMatterStore.setState({ matters: [alpha], activeMatterId: null });
      setDevFlagOverride('selection-authority-boot-gate', true);
      readAuthoritativeMatterScope();
    });
    await act(async () => {
      await requestMatterScopeSelection(issueMatterScopeSelection(alpha.id));
    });

    render(<MatterScopeSelector />);
    const trigger = screen.getByTestId('matter-scope-selector');
    expect(trigger).toHaveAttribute('data-scope', 'matter');
    expect(trigger).toHaveAttribute('data-source-scope', 'matter-only');
    expect(trigger).toHaveAttribute('data-follower-status', 'stale');
    expect(trigger).toHaveTextContent('Updating');
    await act(async () => {
      await vi.runAllTimersAsync();
    });
  });

  it('shows the settled all-matters presentation after sealed explicit intent', async () => {
    act(() => {
      useMatterStore.setState({ matters: [alpha], activeMatterId: alpha.id });
      setDevFlagOverride('selection-authority-boot-gate', true);
      readAuthoritativeMatterScope();
    });
    await act(async () => {
      await requestMatterScopeSelection(issueAllMattersScopeSelection());
    });
    await waitFor(() => {
      expect(useMatterStore.getState().activeMatterId).toBeNull();
    });

    render(<MatterScopeSelector />);
    const trigger = screen.getByTestId('matter-scope-selector');
    expect(readAuthoritativeMatterScope()).toEqual({ kind: 'all-matters' });
    expect(useMatterStore.getState().activeMatterId).toBeNull();
    expect(trigger).toHaveAttribute('data-scope', 'all-matters');
    expect(trigger).toHaveTextContent(/All (matters|clients)/i);
    expect(trigger).not.toHaveTextContent('BLOCKED');
  });

  it('keeps all source arms distinct even when two arms project to null', () => {
    const all = resolveSelectionPresentation({ kind: 'all-matters' }, 'converged');
    const blocked = resolveSelectionPresentation({ kind: 'blocked-unresolved' }, 'converged');

    expect(all).toMatchObject({ allMatters: true, blocked: false, matterId: null });
    expect(blocked).toMatchObject({ allMatters: false, blocked: true, matterId: null });
  });
});
