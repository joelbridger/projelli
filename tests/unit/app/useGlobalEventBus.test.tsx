/**
 * useGlobalEventBus.test.tsx — app-wide CustomEvent forwarding.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useGlobalEventBus, type GlobalEventBusHandlers } from '@/app/lifecycle/useGlobalEventBus';
import { EV_OPEN_SETTINGS } from '@/config/identity';
import { NAVIGATION_TARGET_DISPATCH_EVENT } from '@/app/commands/registry/navigationTargetRegistry';

function makeHandlers(): GlobalEventBusHandlers {
  return {
    onOpenMatterManager: vi.fn(),
    onOpenClientSettings: vi.fn(),
    onOpenNewGroup: vi.fn(),
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

function openSettingsEvent(detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(EV_OPEN_SETTINGS, { detail }));
}

describe('useGlobalEventBus', () => {
  it('routes a non-account settings event to the Settings page when the app shell is available', () => {
    const handlers = {
      ...makeHandlers(),
      openSettingsPage: vi.fn(),
      isAppShellAvailable: true,
    };
    render(<Harness handlers={handlers} />);

    openSettingsEvent({ category: 'ai' });

    expect(handlers.openSettingsPage).toHaveBeenCalledExactlyOnceWith('ai');
    expect(handlers.openSettings).not.toHaveBeenCalled();
    expect(handlers.onOpenAccount).not.toHaveBeenCalled();
  });

  it('keeps the Settings modal fallback when the app shell is unavailable', () => {
    const handlers = {
      ...makeHandlers(),
      openSettingsPage: vi.fn(),
      isAppShellAvailable: false,
    };
    render(<Harness handlers={handlers} />);

    openSettingsEvent({ category: 'ai' });

    expect(handlers.openSettings).toHaveBeenCalledExactlyOnceWith('ai');
    expect(handlers.openSettingsPage).not.toHaveBeenCalled();
  });

  it('keeps account-style settings categories in the Account window', () => {
    const handlers = {
      ...makeHandlers(),
      openSettingsPage: vi.fn(),
      isAppShellAvailable: true,
    };
    render(<Harness handlers={handlers} />);

    openSettingsEvent({ category: 'account' });

    expect(handlers.onOpenAccount).toHaveBeenCalledOnce();
    expect(handlers.openSettingsPage).not.toHaveBeenCalled();
    expect(handlers.openSettings).not.toHaveBeenCalled();
  });

  it('forwards one raw matter intent to the router and does not navigate itself', () => {
    const handlers = makeHandlers();
    const received = vi.fn();
    window.addEventListener(NAVIGATION_TARGET_DISPATCH_EVENT, received);
    render(<Harness handlers={handlers} />);

    const intent = {
      matterId: 'm1',
      surface: 'files',
      source: { kind: 'document', ref: '/workspace/M1/source.docx' },
    };
    launch(intent);

    expect(received).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ detail: intent })
    );
    expect(handlers.setSidebarActiveTab).not.toHaveBeenCalled();
    expect(handlers.setDocumentsView).not.toHaveBeenCalled();
    window.removeEventListener(NAVIGATION_TARGET_DISPATCH_EVENT, received);
  });
});
