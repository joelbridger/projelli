/**
 * useGlobalEventBus.test.tsx — per-client surface routing (matter-isolation).
 *
 * The client-list Documents/Email quick-actions dispatch keepance:matter-launch
 * with surface 'files'/'email'. Those must open the active client's HUB sub-tab
 * (scoped to THIS client), NOT the old GLOBAL files/inbox surfaces — routing to
 * the global surfaces leaked every other client's data. Ask (search) stays a
 * global surface (it's already scoped to the active matter).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useMatterUiStore } from '@/platform/matter/matterUiStore';
import { useGlobalEventBus, type GlobalEventBusHandlers } from '@/app/lifecycle/useGlobalEventBus';

function makeHandlers(): GlobalEventBusHandlers {
  return {
    onOpenMatterManager: vi.fn(),
    onOpenAccount: vi.fn(),
    openSettings: vi.fn(),
    setSidebarActiveTab: vi.fn(),
    setDocumentsView: vi.fn(),
    setAskPrefill: vi.fn(),
  };
}

function Harness({ handlers }: { handlers: GlobalEventBusHandlers }) {
  useGlobalEventBus(handlers);
  return null;
}

function launch(detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent('lantern:matter-launch', { detail }));
}

beforeEach(() => {
  useMatterStore.setState({ matters: [], activeMatterId: null, clientMapHubId: null, clientMapHubTab: null, snapshots: {} });
  // setActiveMatter only honors ids that exist, so seed the matters under test.
  useMatterStore.getState().createMatter({ id: 'm1', name: 'M1', client: 'M1' });
  useMatterStore.getState().createMatter({ id: 'm2', name: 'M2', client: 'M2' });
  useMatterStore.getState().createMatter({ id: 'm3', name: 'M3', client: 'M3' });
});

describe('useGlobalEventBus — per-client surface routing', () => {
  it('routes a Documents quick-action into the hub Documents sub-tab, not the global files surface', () => {
    const handlers = makeHandlers();
    render(<Harness handlers={handlers} />);

    launch({ matterId: 'm1', surface: 'files' });

    expect(handlers.setSidebarActiveTab).toHaveBeenCalledWith('matters');
    expect(handlers.setSidebarActiveTab).not.toHaveBeenCalledWith('files');
    expect(useMatterStore.getState().clientMapHubId).toBe('m1');
    expect(useMatterStore.getState().clientMapHubTab).toBe('documents');
    // Must land on the scoped file LIST, never a stale editor pane from another
    // client (matter isolation).
    expect(handlers.setDocumentsView).toHaveBeenCalledWith('browser');
  });

  it('routes an Email quick-action into the hub Email sub-tab', () => {
    const handlers = makeHandlers();
    render(<Harness handlers={handlers} />);

    launch({ matterId: 'm2', surface: 'email' });

    expect(handlers.setSidebarActiveTab).toHaveBeenCalledWith('matters');
    expect(handlers.setSidebarActiveTab).not.toHaveBeenCalledWith('email');
    expect(useMatterStore.getState().clientMapHubId).toBe('m2');
    expect(useMatterStore.getState().clientMapHubTab).toBe('email');
  });

  it('routes a Meetings quick-action into the hub Meetings sub-tab', () => {
    const handlers = makeHandlers();
    render(<Harness handlers={handlers} />);

    launch({ matterId: 'm2', surface: 'meetings' });

    expect(handlers.setSidebarActiveTab).toHaveBeenCalledWith('matters');
    expect(handlers.setSidebarActiveTab).not.toHaveBeenCalledWith('email');
    expect(useMatterStore.getState().clientMapHubId).toBe('m2');
    expect(useMatterStore.getState().clientMapHubTab).toBe('meetings');
  });

  it('routes an Activity quick-action into the hub Activity sub-tab', () => {
    const handlers = makeHandlers();
    render(<Harness handlers={handlers} />);

    launch({ matterId: 'm2', surface: 'audit' });

    expect(handlers.setSidebarActiveTab).toHaveBeenCalledWith('matters');
    expect(handlers.setSidebarActiveTab).not.toHaveBeenCalledWith('audit');
    expect(useMatterStore.getState().clientMapHubId).toBe('m2');
    expect(useMatterStore.getState().clientMapHubTab).toBe('activity');
  });

  it('routes an explicit Client Map launch to the client hub even when a stale saved surface exists', () => {
    const handlers = makeHandlers();
    useMatterUiStore.getState().saveSnapshot('m2', { surface: 'email', activeTabPath: null });
    render(<Harness handlers={handlers} />);

    launch({ matterId: 'm2', surface: 'matters' });

    expect(handlers.setSidebarActiveTab).toHaveBeenCalledWith('matters');
    expect(handlers.setSidebarActiveTab).not.toHaveBeenCalledWith('email');
    expect(useMatterStore.getState().activeMatterId).toBe('m2');
    expect(useMatterStore.getState().clientMapHubId).toBe('m2');
    expect(useMatterStore.getState().clientMapHubTab).toBe('overview');
  });

  it('leaves Ask (search) as a global surface, scoped to the active client', () => {
    const handlers = makeHandlers();
    render(<Harness handlers={handlers} />);

    launch({ matterId: 'm3', surface: 'search', question: 'who are the beneficiaries?' });

    expect(handlers.setSidebarActiveTab).toHaveBeenCalledWith('search');
    expect(handlers.setAskPrefill).toHaveBeenCalled();
    expect(useMatterStore.getState().activeMatterId).toBe('m3');
    expect(useMatterStore.getState().clientMapHubTab).toBeNull();
  });
});
