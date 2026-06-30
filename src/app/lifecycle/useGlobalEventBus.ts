/**
 * useGlobalEventBus — centralizes the app-wide `lantern:*` CustomEvent wiring
 * that surfaces (the matter hub, the rail account chip, get-started cards, the
 * navy spine) dispatch on `window` to drive the shell.
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
import { openSourceDocument } from '@/features/matters/clientMap/openSource';
import { getActiveWorkspaceService } from '@/app/fileOps/flushDirtyTabs';
import {
  EV_OPEN_MATTER_MANAGER,
  EV_OPEN_SETTINGS,
  EV_OPEN_ACCOUNT,
  EV_MATTER_LAUNCH,
  EV_OPEN_PRIVACY_CENTER,
} from '@/config/identity';
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
  | 'privacy'
  | 'settings'
  | 'trash';

export interface AskPrefill {
  question: string;
  autoSubmit: boolean;
}

export interface GlobalEventBusHandlers {
  /** Open the canonical matter-create dialog (MatterManagerDialog). */
  onOpenMatterManager: () => void;
  /** Open the dedicated Account window, optionally jumping to a specific tab. */
  onOpenAccount: (tab?: string) => void;
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

const ALLOWED_SURFACES = new Set(['search', 'files', 'email', 'workflows', 'audit', 'privacy'] as const);
type AllowedSurface = 'search' | 'files' | 'email' | 'workflows' | 'audit' | 'privacy';

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

    // Rail account identity (or email connect shortcuts) → open the Account window,
    // optionally jumping straight to a named tab (e.g. "connections").
    const onOpenAccount = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: string } | null>).detail?.tab;
      ref.current.onOpenAccount(tab);
    };

    // Matter launch: an explicit surface jumps there; no surface restores the
    // matter's remembered working surface + focused document (or its hub). A
    // `source` payload (Client Map document source link) opens that exact file.
    const onMatterLaunch = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          matterId?: string;
          surface?: string;
          question?: string;
          source?: { kind?: string; ref?: string; snippet?: string };
        } | null>
      ).detail;
      if (!detail?.matterId) return;
      const matterId = detail.matterId;

      // Client Map source link -> open the EXACT cited document and scroll to
      // the cited spot. (Email sources open via lantern:open-email, so only
      // document sources arrive here.) Falls back to the document browser if the
      // file can't be opened.
      const source = detail.source;
      if (source && source.kind === 'document' && typeof source.ref === 'string') {
        useMatterStore.getState().setActiveMatter(matterId);
        ref.current.setSidebarActiveTab('files');
        void openSourceDocument(source.ref, matterId, getActiveWorkspaceService(), source.snippet).then((opened) => {
          ref.current.setDocumentsView(opened ? 'editor' : 'browser');
        });
        return;
      }

      const hasExplicitSurface = ALLOWED_SURFACES.has(detail.surface as AllowedSurface);
      useMatterStore.getState().setActiveMatter(matterId);

      if (hasExplicitSurface) {
        const surface = detail.surface as AllowedSurface;
        // Documents / Email / Activity are no longer GLOBAL destinations — the
        // client-list quick-actions for them must open the active client's HUB
        // sub-tab, scoped to THIS client. Routing them to the old global
        // surfaces leaked every other client's files/inbox/activity (P1). The
        // hub renders inside the Client Map ('matters') tab; a one-shot
        // `clientMapHubTab` tells MatterHub which sub-tab to open.
        const hubTab =
          surface === 'files' ? 'documents'
          : surface === 'email' ? 'email'
          : surface === 'audit' ? 'activity'
          : null;
        if (hubTab) {
          // setActiveMatter ran just above; set the hub id AFTER it (setActiveMatter
          // can clear a hub id that doesn't match the new active matter).
          useMatterStore.getState().setClientMapHubId(matterId);
          useMatterStore.getState().setClientMapHubTab(hubTab);
          // Documents must land on the scoped file LIST, not a stale editor pane
          // that could still show another client's open file (matter isolation).
          if (hubTab === 'documents') ref.current.setDocumentsView('browser');
          ref.current.setSidebarActiveTab('matters');
          return;
        }
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

    // Privacy Center shortcut: jump straight to the privacy surface.
    const onOpenPrivacyCenter = () => ref.current.setSidebarActiveTab('privacy');

    window.addEventListener(EV_OPEN_MATTER_MANAGER, onOpenMatterManager);
    window.addEventListener(EV_OPEN_SETTINGS, onOpenSettings);
    window.addEventListener(EV_OPEN_ACCOUNT, onOpenAccount);
    window.addEventListener(EV_MATTER_LAUNCH, onMatterLaunch);
    window.addEventListener(EV_OPEN_PRIVACY_CENTER, onOpenPrivacyCenter);
    return () => {
      window.removeEventListener(EV_OPEN_MATTER_MANAGER, onOpenMatterManager);
      window.removeEventListener(EV_OPEN_SETTINGS, onOpenSettings);
      window.removeEventListener(EV_OPEN_ACCOUNT, onOpenAccount);
      window.removeEventListener(EV_MATTER_LAUNCH, onMatterLaunch);
      window.removeEventListener(EV_OPEN_PRIVACY_CENTER, onOpenPrivacyCenter);
    };
  }, []);
}
