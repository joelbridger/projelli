/**
 * useGlobalEventBus — centralizes the app-wide `keepance:*` CustomEvent wiring
 * that surfaces (the matter hub, the rail account chip, get-started cards, the
 * navy spine) dispatch on `window` to drive the shell.
 *
 * Extracted from App.tsx (Phase 3 decomposition). Uses the latest-handlers-ref
 * pattern so the listeners are registered exactly once (stable `[]` effect) and
 * always call the current handlers — preserving the original behavior where
 * each listener effect mounted once for the life of the app.
 */
import { useEffect, useRef } from 'react';
import type { SettingCategory } from '@/platform/settings/schema';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useMatterUiStore } from '@/platform/matter/matterUiStore';
import { useEditorStore } from '@/platform/state/editorStore';

/** The shell's left-nav surfaces (the `sidebarActiveTab` union). */
export type AppSurface =
  | 'files'
  | 'matters'
  | 'search'
  | 'email'
  | 'workflows'
  | 'ai-assistant'
  | 'research'
  | 'audit'
  | 'settings'
  | 'trash';

export interface AskPrefill {
  question: string;
  autoSubmit: boolean;
}

export interface GlobalEventBusHandlers {
  /** Open the canonical matter-create dialog (MatterManagerDialog). */
  onOpenMatterManager: () => void;
  /** Open the dedicated Account window. */
  onOpenAccount: () => void;
  /** Open Settings deep-linked to a category. */
  openSettings: (category?: SettingCategory) => void;
  setSidebarActiveTab: (tab: AppSurface) => void;
  setDocumentsView: (view: 'browser' | 'editor') => void;
  setAskPrefill: (prefill: AskPrefill | null) => void;
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

const ALLOWED_SURFACES = new Set(['search', 'files', 'email', 'workflows', 'audit'] as const);
type AllowedSurface = 'search' | 'files' | 'email' | 'workflows' | 'audit';

export function useGlobalEventBus(handlers: GlobalEventBusHandlers): void {
  // Keep the latest handlers in a ref so the listeners below register once.
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    // "New matter" buttons → open MatterManagerDialog.
    const onOpenMatterManager = () => ref.current.onOpenMatterManager();

    // GetStartedCard etc. → open Settings (or the Account window for
    // account-related categories).
    const onOpenSettings = (e: Event) => {
      const category = (
        e as CustomEvent<{ category?: SettingCategory }>
      ).detail?.category;
      if (category && ACCOUNT_CATEGORIES.has(category)) {
        ref.current.onOpenAccount();
        return;
      }
      ref.current.openSettings(category);
    };

    // Rail account identity → open the Account window.
    const onOpenAccount = () => ref.current.onOpenAccount();

    // Matter launch: an explicit surface jumps there; no surface restores the
    // matter's remembered working surface + focused document (or its hub).
    const onMatterLaunch = (e: Event) => {
      const detail = (
        e as CustomEvent<{ matterId?: string; surface?: string; question?: string } | null>
      ).detail;
      if (!detail?.matterId) return;
      const matterId = detail.matterId;
      const hasExplicitSurface = ALLOWED_SURFACES.has(detail.surface as AllowedSurface);
      useMatterStore.getState().setActiveMatter(matterId);

      if (hasExplicitSurface) {
        const surface = detail.surface as AllowedSurface;
        if (surface === 'files') ref.current.setDocumentsView('browser');
        ref.current.setSidebarActiveTab(surface);
        if (surface === 'search' && detail.question) {
          ref.current.setAskPrefill({ question: detail.question, autoSubmit: true });
        }
        return;
      }

      const snap = useMatterUiStore.getState().getSnapshot(matterId);
      if (!snap) {
        ref.current.setSidebarActiveTab('matters');
        return;
      }
      if (snap.surface === 'files' && snap.activeTabPath) {
        const tabs = useEditorStore.getState().openTabs;
        if (tabs.some((t) => t.path === snap.activeTabPath)) {
          useEditorStore.getState().setActiveTab(snap.activeTabPath);
          ref.current.setDocumentsView('editor');
        } else {
          ref.current.setDocumentsView('browser');
        }
      } else if (snap.surface === 'files') {
        ref.current.setDocumentsView('browser');
      }
      ref.current.setSidebarActiveTab(snap.surface as AppSurface);
    };

    window.addEventListener('keepance:open-matter-manager', onOpenMatterManager);
    window.addEventListener('keepance:open-settings', onOpenSettings);
    window.addEventListener('keepance:open-account', onOpenAccount);
    window.addEventListener('keepance:matter-launch', onMatterLaunch);
    return () => {
      window.removeEventListener('keepance:open-matter-manager', onOpenMatterManager);
      window.removeEventListener('keepance:open-settings', onOpenSettings);
      window.removeEventListener('keepance:open-account', onOpenAccount);
      window.removeEventListener('keepance:matter-launch', onMatterLaunch);
    };
  }, []);
}
