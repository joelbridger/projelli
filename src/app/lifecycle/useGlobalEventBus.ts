/**
 * useGlobalEventBus — centralizes the app-wide `lantern:*` CustomEvent wiring
 * that surfaces (the matter hub, the rail account chip, get-started cards, the
 * navy spine) dispatch on `window` to drive the shell.
 * Extracted from App.tsx (Phase 3 decomposition). Uses the latest-handlers-ref
 * pattern so the listeners are registered exactly once (stable `[]` effect) and
 * always call the current handlers — preserving the original behavior where
 * each listener effect mounted once for the life of the app.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { SettingCategory } from '@/platform/settings/schema';
import type { MattersSurfaceMode } from '@/platform/state/appNavigationStore';
import {
  dispatchNavigationTarget,
  type MatterNavigationTarget,
} from '@/app/commands/registry/navigationTargetRegistry';
import {
  EV_OPEN_MATTER_MANAGER,
  EV_OPEN_CLIENT_SETTINGS,
  EV_OPEN_NEW_GROUP,
  EV_OPEN_SETTINGS,
  EV_OPEN_ACCOUNT,
  EV_MATTER_LAUNCH,
  EV_OPEN_PRIVACY_CENTER,
} from '@/config/identity';
export type { AppSurface } from '@/platform/types/navigation';
import type { AppSurface } from '@/platform/types/navigation';

export interface AskPrefill {
  question: string;
  autoSubmit: boolean;
}

export interface GlobalEventBusHandlers {
  /** Open the calm one-field "add a client" modal (NewClientDialog). */
  onOpenMatterManager: () => void;
  /** Open the per-client settings dialog (MatterManagerDialog), optionally
   *  focused on (expanded to) a specific client. */
  onOpenClientSettings: (matterId: string | null) => void;
  /** Open the "add a group of clients" modal (NewClientGroupDialog). */
  onOpenNewGroup: () => void;
  /** Open the dedicated Account window, optionally jumping to a specific tab. */
  onOpenAccount: (tab?: string) => void;
  /** Open Settings deep-linked to a category. */
  openSettings: (category?: SettingCategory) => void;
  /** Open the in-shell Settings page deep-linked to a category. */
  openSettingsPage?: (category?: SettingCategory) => void;
  /** True when the full app shell is visible and can host the Settings page. */
  isAppShellAvailable?: boolean;
  setSidebarActiveTab: (tab: AppSurface) => void;
  setDocumentsView: (view: 'browser' | 'editor') => void;
  setAskPrefill: (prefill: AskPrefill | null) => void;
  setMattersSurfaceMode?: (mode: MattersSurfaceMode) => void;
  pushNavigationSnapshot?: () => void;
}

// Account-related settings categories live in the Account window, so an
// open-settings request for one of these is redirected there.
const ACCOUNT_CATEGORIES = new Set<SettingCategory>([
  'account',
  'license',
  'firm',
  'costs',
  'integrations',
]);

export function useGlobalEventBus(handlers: GlobalEventBusHandlers): void {
  // Keep the latest handlers in a ref so the listeners below register once.
  const ref = useRef(handlers);

  useLayoutEffect(() => {
    ref.current = handlers;
  }, [handlers]);

  useEffect(() => {
    // "+ New client" buttons → open the calm NewClientDialog.
    const onOpenMatterManager = () => {
      ref.current.onOpenMatterManager();
    };

    // Row-menu "Client settings" → open the per-client management dialog,
    // focused on the requested client.
    const onOpenClientSettings = (e: Event) => {
      const matterId = (e as CustomEvent<{ matterId?: string } | null>).detail
        ?.matterId;
      ref.current.onOpenClientSettings(matterId ?? null);
    };

    // CLIENTS rail plus menu -> "New group" → open the group modal.
    const onOpenNewGroup = () => {
      ref.current.onOpenNewGroup();
    };

    // GetStartedCard etc. → open Settings (or the Account window for
    // account-related categories).
    const onOpenSettings = (e: Event) => {
      const category = (e as CustomEvent<{ category?: SettingCategory } | null>)
        .detail?.category;
      if (category && ACCOUNT_CATEGORIES.has(category)) {
        ref.current.onOpenAccount();
        return;
      }
      if (ref.current.isAppShellAvailable && ref.current.openSettingsPage) {
        ref.current.openSettingsPage(category);
        return;
      }
      ref.current.openSettings(category);
    };

    // Rail account identity (or email connect shortcuts) → open the Account window,
    // optionally jumping straight to a named tab (e.g. "connections").
    const onOpenAccount = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: string } | null>).detail?.tab;
      ref.current.onOpenAccount(tab);
    };

    // Matter launch is routed by AppSurfaceRouter, where the one legitimate
    // AppSurfaceRuntime exists. Keep this bus deliberately payload-blind.
    const onMatterLaunch = (e: Event) => {
      const detail = (e as CustomEvent<Partial<MatterNavigationTarget> | null>)
        .detail;
      if (!detail?.matterId) return;
      dispatchNavigationTarget(detail as MatterNavigationTarget);
    };

    // Privacy Center shortcut: jump straight to the privacy surface.
    const onOpenPrivacyCenter = () => {
      ref.current.setSidebarActiveTab('privacy');
    };

    window.addEventListener(EV_OPEN_MATTER_MANAGER, onOpenMatterManager);
    window.addEventListener(EV_OPEN_CLIENT_SETTINGS, onOpenClientSettings);
    window.addEventListener(EV_OPEN_NEW_GROUP, onOpenNewGroup);
    window.addEventListener(EV_OPEN_SETTINGS, onOpenSettings);
    window.addEventListener(EV_OPEN_ACCOUNT, onOpenAccount);
    window.addEventListener(EV_MATTER_LAUNCH, onMatterLaunch);
    window.addEventListener(EV_OPEN_PRIVACY_CENTER, onOpenPrivacyCenter);
    return () => {
      window.removeEventListener(EV_OPEN_MATTER_MANAGER, onOpenMatterManager);
      window.removeEventListener(EV_OPEN_CLIENT_SETTINGS, onOpenClientSettings);
      window.removeEventListener(EV_OPEN_NEW_GROUP, onOpenNewGroup);
      window.removeEventListener(EV_OPEN_SETTINGS, onOpenSettings);
      window.removeEventListener(EV_OPEN_ACCOUNT, onOpenAccount);
      window.removeEventListener(EV_MATTER_LAUNCH, onMatterLaunch);
      window.removeEventListener(EV_OPEN_PRIVACY_CENTER, onOpenPrivacyCenter);
    };
  }, []);
}
