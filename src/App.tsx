/**
 * Lantern — Local-first AI workspace for confidential client work.
 *
 * Core Thesis: This is NOT a chat UI. It is an artifact-driven workspace
 * where AI proposes and the user approves all destructive actions.
 */

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { workspacePath } from '@/platform/fs/appPath';
import {
  useGlobalEventBus,
  type AppSurface,
} from '@/app/lifecycle/useGlobalEventBus';
import { useAutosave } from '@/app/lifecycle/useAutosave';
import { useFlushOnExit } from '@/app/lifecycle/useFlushOnExit';
import { useThemeManager } from '@/app/lifecycle/useThemeManager';
import { useWorkspaceLifecycle } from '@/app/lifecycle/useWorkspaceLifecycle';
import { useAutoResumeWorkspace } from '@/app/lifecycle/useAutoResumeWorkspace';
import { usePreStartLocalAi } from '@/app/lifecycle/usePreStartLocalAi';
import { useTestModeWorkspace } from '@/app/lifecycle/useTestModeWorkspace';
import {
  getExplicitLaunchWorkspace,
  shouldShowFirstRunForLaunch,
  shouldUseExplicitLaunchWorkspace,
} from '@/app/lifecycle/explicitLaunchWorkspace';
import { useKeyboardShortcuts } from '@/app/commands/useKeyboardShortcuts';
import { useAppCommands } from '@/app/commands/useAppCommands';
import { useDialogManager } from '@/app/dialogs/useDialogManager';
import { useFileOperations } from '@/app/fileOps/useFileOperations';
import { useDocumentCreation } from '@/app/fileOps/useDocumentCreation';
import { useWorkflowRunner } from '@/app/workflow/useWorkflowRunner';
import { useAudioRecording } from '@/app/lifecycle/useAudioRecording';
import { useAIRulesFile } from '@/app/lifecycle/useAIRulesFile';
import { useFileImport } from '@/app/fileOps/useFileImport';
import { getSettingsActions } from '@/app/hooks/getSettingsActions';
import { useTabOpening } from '@/app/lifecycle/useTabOpening';
import { WorkspaceSelector } from '@/features/documents/workspace/WorkspaceSelector';
import { registerFirmWorkspaceSwitcher } from '@/features/crm-firm/workspaceSwitching';

import { AppShellNav } from '@/app/shell/layout/AppShellNav';
import { SettingsGearButton } from '@/app/shell/layout/SettingsGearButton';
import { TrustBar } from '@/app/shell/layout/TrustBar';
import { StatusBar } from '@/app/shell/layout/StatusBar';
import { AppDialogs } from '@/app/shell/AppDialogs';
import { AppSurfaceRouter } from '@/app/shell/AppSurfaceRouter';
import { AppSurfaceRuntimeProvider } from '@/app/shell/runtime/AppSurfaceRuntimeProvider';
import type { AppSurfaceCapabilities } from '@/app/shell/runtime/AppSurfaceRuntime';
import { getAppSurfaceDescriptor } from '@/app/shell/registry/appSurfaceRegistry';
import { V1ShellFrameFlagGate } from '@/app/shell/v1-frame/V1ShellFrame';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { RecordPill } from '@/features/meetings/RecordPill';
import { MeetingAutoJoinScheduler } from '@/features/meetings/MeetingAutoJoinScheduler';
import { AutoJoinMeetingsPanel } from '@/features/meetings/AutoJoinMeetingsPanel';
import { LazyBoundary } from '@/ui/LazyBoundary';

import { AppLogo } from '@/ui/brand/AppLogo';
import { Button } from '@/ui/button';
import { IconButton } from '@/ui/kp';
import { Command } from 'lucide-react';
import { TrialBanner } from '@/features/account/trial';
import { hasCompletedOnboarding } from '@/features/onboarding';
// FirstRunOverlay renders the live 4-step OnboardingV2 flow.
import { FirstRunOverlay } from '@/features/onboarding/FirstRunOverlay';
import {
  createKeychainService,
  migrateLocalStorageApiKeysToKeychain,
} from '@/platform/providers/KeychainService';
import { sendEvent } from '@/platform/utils/telemetry';
import { useFeatureTour } from '@/platform/hooks/useFeatureTour';
// M1 (v1.5) Memory: workspace RAG indexer + status UI.
import { ModelDownloadCard } from '@/platform/rag/ui/ModelDownloadCard';
import { LocalAiDownloadCard } from '@/platform/rag/ui/LocalAiDownloadCard';
import { RagProgressBanner } from '@/platform/rag/ui/RagProgressBanner';
import { ScopeUpdateBanner } from '@/platform/rag/ui/ScopeUpdateBanner';
import { useMemoryWiring } from '@/platform/hooks/useMemoryWiring';
import { useGlobalFileDrop } from '@/app/shell/common/GlobalDropOverlay';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import {
  useEditorStore,
  setBeforeTabClose,
  setBeforeDocxClose,
} from '@/platform/state/editorStore';
import {
  isDocxRegistered,
  closeDocxTabSafely,
} from '@/platform/fs/docxSaveRegistry';
import { flushTabForClose } from '@/app/fileOps/flushDirtyTabs';
import { useWorkflowStore } from '@/features/workflows/workflowStore';
import { useShallow } from 'zustand/react/shallow';
import {
  createWorkspaceService,
  type WorkspaceService,
} from '@/platform/fs/WorkspaceService';
import {
  createFSBackend,
  isTauriEnvironment,
} from '@/platform/fs/BackendFactory';
import { flushAllDirtyTabs } from '@/app/fileOps/flushDirtyTabs';
import { useTabWriteGuard } from '@/platform/browserGuard/useTabWriteGuard';

// flushAllDirtyTabs returns failed .docx paths, while the tab guard needs a
// completion-only callback. Keep this adapter module-stable: guard ownership
// must not restart merely because App rendered again.
async function flushDirtyTabsForTabGuard(): Promise<void> {
  await flushAllDirtyTabs();
}
import { TabGateOverlay } from '@/platform/browserGuard/TabGateOverlay';
import { useAiBatchReviewStore } from '@/platform/ai/aiBatchReviewStore';
import { createWebFSBackend } from '@/platform/fs/WebFSBackend';
import { writeSampleFiles } from '@/platform/matter/samples';
import { seedSampleClientMap } from '@/platform/matter/samples/sampleClientMap';
import { seedSampleGoldenPath } from '@/features/onboarding/seedSampleGoldenPath';
import { useProfessionStore } from '@/platform/profile/professionStore';
import type {
  OnboardingStartMode,
  OnboardingStartResult,
} from '@/features/onboarding/onboardingTypes';
import type { TrashedItem } from '@/platform/history/TrashService';

import type { AuditEntry } from '@/platform/types/audit';
import { AuditService } from '@/platform/audit/AuditService';
import {
  setAuditWriteEmitter,
  type AuditWriteEntry,
} from '@/features/audit';
import { setEmailAuditEmitter } from '@/features/email/EmailViewer';
import { setIntakeNudgeAuditEmitter } from '@/platform/intake/nudgeAudit';
import { setIntakeEmailReplyAuditEmitter } from '@/platform/intake/emailReplyAudit';
import { setIntakeDocumentExtractionAuditEmitter } from '@/platform/intake/documentExtractionAudit';
import type { AuditIntegrityVerdict } from '@/platform/utils/tauri-commands';
import {
  getOrCreateSampleMatter,
  setMatterAuditEmitter,
  setMatterAuditEmitterAsync,
  useMatterStore,
  useMatters,
} from '@/platform/matter/matterStore';
import {
  useMatterUiStore,
  isWorkingSurface,
} from '@/platform/matter/matterUiStore';
import { usePrivilegedMatterModeActive } from '@/platform/hooks/usePrivilegedMatterMode';
import {
  issueAllMattersScopeSelection,
  issueMatterScopeSelection,
  readSelectionPresentation,
  requestMatterScopeSelection,
  useSelectionPresentation,
} from '@/platform/client-context';
import {
  requestNativeNetworkLockdown,
  useNativeNetworkLockdownBridgeState,
} from '@/platform/privacy/nativeNetworkLockdownBridge';
import {
  writeDenyAllMcpSessionScopeFile,
  writeMcpSessionScopeFile,
} from '@/platform/mcp/mcpSessionScope';

import {
  TemplateMetadataReader,
  type MarketplaceService,
} from '@/features/workflows/marketplace/svc';
import { isWorkflowFilePath } from '@/features/workflows/engine/workflowFile';
import { loadAllTemplates } from '@/features/workflows/engine/userTemplates';
import {
  FileSystemWatcher,
  createFileTreeSnapshot,
} from '@/platform/fs/FileSystemWatcher';

import {
  isBinaryFile,
  arrayBufferToDataUrl,
  getMimeType,
} from '@/platform/utils/file-utils';
import { useTrash } from '@/platform/hooks/useTrash';
import { useSourceCards } from '@/app/hooks/useSourceCards';
import { useAIChatFiles } from '@/platform/hooks/useAIChatFiles';
import { useApiKeys } from '@/platform/hooks/useApiKeys';
import {
  useSettingsStore,
  useSettingsHydrated,
} from '@/platform/settings/settingsStore';
import type { SettingCategory } from '@/platform/settings/schema';
import { vaultStatus } from '@/platform/firm/vault/vaultClient';
import { withTimeout } from '@/lib/withTimeout';
import { raceDialogWithWatchdog } from '@/platform/fs/dialogWatchdog';
import { useOpenFileAIContext } from '@/platform/hooks/useOpenFileAIContext';
import { useTemplatesMarketplaceStore } from '@/features/workflows/templatesMarketplaceStore';
import { useModelList } from '@/platform/hooks/useModelList';
import { useContentIndex } from '@/platform/hooks/useContentIndex';
import { useMailSync } from '@/features/email/useMailSync';
import { useMailSyncAudit } from '@/platform/connectors/email/useMailSyncAudit';

import type { MailIndexChunk } from '@/platform/utils/mail-commands';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { PromptDialog } from '@/ui/PromptDialog';
import { usePromptDialog } from '@/platform/hooks/usePromptDialog';
import { useUndoToast } from '@/app/shell/common/UndoToast';
import { InlineErrorBanner } from '@/app/shell/common/InlineErrorBanner';
import { installEarlyConnectorEventBridge } from '@/app/shell/connectorEventBridge';
import {
  sanitizeNavigationSnapshotForCurrentMatters,
  useAppNavigationStore,
  type MattersSurfaceMode,
} from '@/platform/state/appNavigationStore';

// Nine connector citation viewers, none of which render anything until their
// own window event fires — bundled into one lazy chunk (see
// ConnectorSourcePanels.tsx) so they don't ride into the startup bundle.
const loadConnectorSourcePanels = () =>
  import('@/app/shell/ConnectorSourcePanels');

// Module-level constants so the onboarding/tour effects have stable deps
// and never need to be listed in exhaustive-deps disable comments.
// `?testMode=true` predates the desktop harness and deliberately installs an
// in-memory workspace for browser component/E2E tests. `LANTERN_TEST_MODE=1`
// is different: it only removes first-run decoration so desktop runs still
// use their selected folder and the real encrypted store.
const IS_LEGACY_TEST_MODE =
  typeof window !== 'undefined' &&
  window.location.search.includes('testMode=true');
const IS_AUTOMATION_TEST_MODE =
  typeof window !== 'undefined' && window.__LANTERN_TEST_MODE__ === true;
const IS_TEST_MODE = IS_LEGACY_TEST_MODE || IS_AUTOMATION_TEST_MODE;
// `__LANTERN_DEMO__` is substituted to `true` at build time by
// vite.config.web-demo.ts. We must read it here (not just the runtime
// `window.__lanternDemo` flag) because this const is evaluated at module
// import time — which happens BEFORE web-demo/main.tsx sets the window flag,
// so the window flag alone is always `false` in the built demo bundle.
declare const __LANTERN_DEMO__: boolean | undefined;
const IS_DEMO_MODE =
  typeof window !== 'undefined' &&
  ((typeof __LANTERN_DEMO__ !== 'undefined' && __LANTERN_DEMO__) ||
    (window as unknown as { __lanternDemo?: boolean }).__lanternDemo === true);

// Set by a DEBUG native host only. The reader rejects it in production builds.
const EXPLICIT_LAUNCH_WORKSPACE = getExplicitLaunchWorkspace();
// The onboarding picker is another entrance to the same workspace-opening
// flow as the regular selector. Keep its non-interactive work bounded too, so
// its button can show a useful error instead of staying at "Opening…" forever.
const ONBOARDING_WORKSPACE_OPEN_TIMEOUT_MS = 30_000;
const ONBOARDING_WORKSPACE_OPEN_LABEL = 'Opening the workspace';

/**
 * QA-15: the browser build has no per-workspace localStorage namespacing —
 * two tabs on the same origin silently clobber each other's saved state
 * (zustand/persist, last-write-wins, no cross-tab awareness). Desktop
 * already has an OS-level single-instance guard, and IS_TEST_MODE never
 * simulates two same-origin tabs, so the gate is disabled for both.
 *
 * This check MUST live in a component separate from AppShell, not as an
 * early return inside it — AppShell calls dozens of hooks, several with
 * effects that write shared state independent of user interaction (e.g. the
 * demo-mode auto-open effect below calls handleWorkspaceSelected on mount).
 * An early return inside AppShell would still run every hook/effect declared
 * above it (React runs a component's hooks unconditionally regardless of
 * what it returns), so a blocked tab could still write. Only NOT MOUNTING
 * AppShell at all guarantees none of its effects ever run in a blocked tab.
 * See src/platform/browserGuard/ for the guard itself and its rationale.
 */
function App() {
  // onFlushRequested (round 5 codex-review P1) is the ONLY flush trigger on
  // this side of a handoff — deliberately NOT "flush whenever this tab
  // becomes blocked". Those are different situations: `onFlushRequested`
  // only ever fires while this tab is STILL 'owner', in direct response to
  // another tab's coordinated flush-request BEFORE it claims the lock, so
  // this tab's buffer is still the authoritative latest state at the moment
  // it flushes. An earlier version of this also flushed unconditionally
  // whenever status became 'blocked' — that additionally covers the
  // AUTOMATIC/involuntary demotion path (this tab was frozen/throttled, its
  // heartbeat went stale, and another tab reclaimed the lock on its own
  // without asking). By the time a stale-reclaimed tab wakes up and notices
  // it's blocked, the new owner may have already read and saved newer state
  // — flushing this tab's now-stale buffer at that point would silently
  // overwrite the new owner's real changes, reintroducing exactly the
  // last-write-wins clobber this whole guard exists to prevent (coordinator
  // P1, round 6). Losing this tab's own unsaved edits when it was the one
  // that went stale is an honest, bounded loss; clobbering someone else's
  // newer save is not.
  const tabWriteGuard = useTabWriteGuard(
    !IS_TEST_MODE && !isTauriEnvironment(),
    {
      // The adapter deliberately ignores failed paths, preserving the existing
      // handoff semantics while keeping its identity stable across renders.
      onFlushRequested: flushDirtyTabsForTabGuard,
    }
  );
  if (tabWriteGuard.status === 'blocked') {
    return <TabGateOverlay onTakeOver={tabWriteGuard.requestTakeover} />;
  }
  return <AppShell />;
}

function AppShell() {
  const { t } = useTranslation();
  const [showWorkspaceSelector, setShowWorkspaceSelector] = useState(
    !IS_TEST_MODE && !IS_DEMO_MODE
  );
  const [demoOpenFailed, setDemoOpenFailed] = useState(false);
  const {
    showCommandPalette,
    setShowCommandPalette,
    showShortcutsOverlay,
    setShowShortcutsOverlay,
    showQuickOpen,
    setShowQuickOpen,
    showAudioRecorder,
    setShowAudioRecorder,
    showSettingsModal,
    setShowSettingsModal,
    settingsInitialCategory,
    openSettings,
    accountWindowOpen,
    setAccountWindowOpen,
    matterManagerOpen,
    setMatterManagerOpen,
    newClientOpen,
    setNewClientOpen,
    newGroupOpen,
    setNewGroupOpen,
    clientSettingsMatterId,
    setClientSettingsMatterId,
    showWhatsNewModalDirect,
    setShowWhatsNewModalDirect,
    apiKeyWizardOpen,
    setApiKeyWizardOpen,
    apiKeyManagerOpen,
    setApiKeyManagerOpen,
  } = useDialogManager();
  // Tab to pre-select inside the Account window (e.g. 'connections' from the
  // email connect entry points). Cleared when the window closes.
  const [accountWindowInitialTab, setAccountWindowInitialTab] = useState<
    string | undefined
  >(undefined);
  // Shared contract — "Ask from the matter hub prefills Search".
  // MatterHub dispatches a lantern:matter-launch event with surface='search'
  // and a question string; App sets this state; Ask consumes it.
  const [askPrefill, setAskPrefill] = useState<{
    question: string;
    autoSubmit?: boolean;
  } | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const featureTour = useFeatureTour();

  // First-run onboarding: the rebuilt FirstRunWizard is the live first-run
  // surface (welcome -> profession -> workspace -> data map -> AI setup ->
  // demo -> done). It supersedes the old WelcomeOnboardingDialog, which had
  // only the email/telemetry consent step — the wizard now owns the welcome
  // moment. Triggered when there is no completed-onboarding flag AND no recent
  // workspace (matching the wizard's documented first-run condition), and
  // suppressed in test/demo modes. `?forceOnboarding=true` forces it for QA.
  const [showFirstRun, setShowFirstRun] = useState(false);
  // Wait for Recents to hydrate so this cannot steal a normal reopen-last launch.
  const [explicitLaunchDecisionComplete, setExplicitLaunchDecisionComplete] =
    useState(!EXPLICIT_LAUNCH_WORKSPACE);
  const [explicitWorkspaceForFirstRun, setExplicitWorkspaceForFirstRun] =
    useState<string | null>(null);
  const recentWorkspacesAtLaunch = useWorkspaceStore((s) => s.recentWorkspaces);
  const recentWorkspacesLoadedAtLaunch = useWorkspaceStore((s) => s.recentWorkspacesLoaded);

  // ConnectorSourcePanels is only rendered (and its chunk fetched) once a
  // connector citation is actually clicked — rendering it unconditionally,
  // even self-gating on nothing "open", would still start its import()
  // immediately. This tiny, always-eager listener catches the FIRST click
  // (which can land before the chunk would otherwise have loaded) and
  // buffers/replays it once the panels mount.
  const [connectorPanelsNeeded, setConnectorPanelsNeeded] = useState(false);
  useEffect(
    () =>
      installEarlyConnectorEventBridge(() => {
        setConnectorPanelsNeeded(true);
      }),
    []
  );

  // Anonymous telemetry: emit one app_launch event per session, gated
  // by user consent. Other lifecycle events (trial_start, trial_end,
  // license_activated, license_deactivated) live in their respective
  // hooks so they fire from the source of the state change.
  useEffect(() => {
    void sendEvent('app_launch');
  }, []);

  useEffect(() => {
    if (!recentWorkspacesLoadedAtLaunch) return;
    setExplicitWorkspaceForFirstRun(
      shouldUseExplicitLaunchWorkspace({
        hasCandidate: Boolean(EXPLICIT_LAUNCH_WORKSPACE),
        onboardingComplete: hasCompletedOnboarding(),
        recentWorkspacesLoaded: recentWorkspacesLoadedAtLaunch,
        noRecentWorkspaces: recentWorkspacesAtLaunch.length === 0,
        isTestMode: IS_TEST_MODE,
        isDemoMode: IS_DEMO_MODE,
      }) ? EXPLICIT_LAUNCH_WORKSPACE : null,
    );
    setExplicitLaunchDecisionComplete(true);
  }, [recentWorkspacesLoadedAtLaunch, recentWorkspacesAtLaunch.length]);

  useEffect(() => {
    if (!recentWorkspacesLoadedAtLaunch || !explicitLaunchDecisionComplete) return;
    // Mount the wizard after a tiny delay so the workspace selector gets to
    // render first — the wizard then layers over it as a full-screen overlay,
    // honoring the existing path-input vs file-picker flow underneath.
    const forceOnboarding =
      typeof window !== 'undefined' &&
      window.location.search.includes('forceOnboarding=true');
    const shouldShow = shouldShowFirstRunForLaunch({
      onboardingComplete: hasCompletedOnboarding(),
      noRecentWorkspaces: recentWorkspacesAtLaunch.length === 0,
      isTestMode: IS_TEST_MODE,
      isDemoMode: IS_DEMO_MODE,
      hasExplicitWorkspace: Boolean(explicitWorkspaceForFirstRun),
      forceOnboarding,
    });
    if (shouldShow) {
      const id = setTimeout(() => setShowFirstRun(true), 1200);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [recentWorkspacesLoadedAtLaunch, explicitLaunchDecisionComplete, recentWorkspacesAtLaunch.length, explicitWorkspaceForFirstRun]);

  // v1.6: auto-show feature tour on first launch (post-first-run wizard) once
  // the sidebar testids exist in the DOM. Persistent flag stops re-triggering.
  // Suppressed in test mode (other E2E specs) unless the URL explicitly opts
  // in via ?forceTour=true. The dedicated tour spec uses the opt-in, which
  // also bypasses the persistent completed/skipped flags for fast iteration.
  // The tour must not open while the onboarding overlay is still visible.
  const FORCE_TOUR =
    typeof window !== 'undefined' &&
    window.location.search.includes('forceTour=true');
  useEffect(() => {
    if (
      (IS_TEST_MODE || IS_DEMO_MODE || explicitWorkspaceForFirstRun) &&
      !FORCE_TOUR
    )
      return;
    if (!FORCE_TOUR && !featureTour.shouldAutoShow) return;
    // Do not open the tour while the onboarding overlay is open.
    if (showFirstRun) return;
    const timeoutId = setTimeout(() => setTourOpen(true), 800);
    return () => clearTimeout(timeoutId);
  }, [FORCE_TOUR, featureTour.shouldAutoShow, showFirstRun, explicitWorkspaceForFirstRun]);
  const workspaceServiceRef = useRef<WorkspaceService | null>(null);
  const fileSystemWatcherRef = useRef<FileSystemWatcher | null>(null);

  // Lantern 3.0 — the audit "defense file" persistence layer. On the desktop
  // this writes every AI-action audit entry to a SQLCipher-ENCRYPTED store at
  // rest; in the browser it falls back to (unencrypted) localStorage. Created
  // once and pointed at the active workspace in `handleWorkspaceSelected`. The
  // `auditEntries` React state below is the live view; `addAuditEntry` adds a
  // pending row immediately, then refreshes its saved/failed status later.
  const auditServiceRef = useRef<AuditService>(new AuditService());

  // Stream C1 — Templates Marketplace service. Constructed once when a
  // workspace is selected (each workspace gets its own install root under
  // `<workspaceRoot>/.lantern/templates`). The metadata reader reads
  // installed entries off disk and adapts them into WorkflowTemplate for the
  // engine. Both refs are nullable until a workspace is loaded.
  const templatesMarketplaceServiceRef = useRef<MarketplaceService | null>(
    null
  );
  const templatesMetadataReaderRef = useRef<TemplateMetadataReader | null>(
    null
  );

  // D11: Home is the landing surface; Clients and Ask are the other two tabs.
  const [sidebarActiveTab, setSidebarActiveTab] =
    useState<AppSurface>('home');
  const [settingsPageFocus, setSettingsPageFocus] = useState<{
    category?: SettingCategory;
    key: number;
  }>({ key: 0 });
  // Per-matter UI memory (matterUiStore): subscribe to the active matter so we
  // can save + restore each matter's last working surface and focused document.
  const selectionPresentation = useSelectionPresentation();
  const activeMatterId = selectionPresentation.matterId;
  const matters = useMatters();
  const activeMatter = activeMatterId
    ? matters.find((matter) => matter.id === activeMatterId && !matter.archived) ?? null
    : null;
  const requestedNetworkLockdown = usePrivilegedMatterModeActive();
  const enforcedNetworkLockdown = useNativeNetworkLockdownBridgeState();

  // Keep the native socket guard in step with the app's one effective privacy
  // switch. Native code starts closed, so a failed bridge leaves CRM blocked
  // rather than briefly trusting a stale setting from an earlier launch.
  useLayoutEffect(() => {
    if (!isTauriEnvironment()) return;
    requestNativeNetworkLockdown(requestedNetworkLockdown);
  }, [requestedNetworkLockdown]);
  // F-509 — controlled sidebar collapse so the global Ctrl+B shortcut and the
  // command palette can drive the same collapse the chevron button does.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Fix 1: which view the Documents surface should land on. DocumentsHome
  // UNMOUNTS/REMOUNTS on every tab switch, so a counter "reset signal" can't work
  // (its refs reset on remount). Instead App owns the intent here (it persists
  // across the remount) and DocumentsHome reads it in its useState
  // initializer on mount. Clicking the Documents nav, revealing a folder, or
  // launching a matter into Documents => 'browser' (the file list). Opening an
  // email/file into the Documents area => 'editor' (that document).
  const [documentsView, setDocumentsView] = useState<'browser' | 'editor'>(
    'browser'
  );
  const [mattersSurfaceMode, setMattersSurfaceMode] =
    useState<MattersSurfaceMode>('client-map');

  const handleRequestApiKeySetup = useCallback(() => {
    setApiKeyWizardOpen(true);
  }, []);

  // Audit log state
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditIntegrity, setAuditIntegrity] = useState<
    AuditIntegrityVerdict | undefined
  >();

  const verifyAuditIntegrity = useCallback(async (): Promise<
    AuditIntegrityVerdict | undefined
  > => {
    const verdict = await auditServiceRef.current.verifyIntegrity();
    setAuditIntegrity(verdict);
    return verdict;
  }, []);

  // Explicit, acknowledged repair of a seal-missing audit log (invoked from the
  // AuditHome badge after the user confirms). Re-seals + records the anomaly in
  // the backend, then refreshes the live entries AND the integrity badge so the
  // new anomaly row appears and the amber state clears to verified.
  const repairAuditSeal = useCallback(async (): Promise<void> => {
    await auditServiceRef.current.repairSeal();
    setAuditEntries(auditServiceRef.current.getAll().slice().reverse());
    setAuditIntegrity(await auditServiceRef.current.verifyIntegrity());
  }, []);

  useThemeManager();

  // Perf (P1.2): exact-data-only selectors. These bare store-hook calls used
  // to subscribe to the ENTIRE workspace/editor/workflow state (e.g. every
  // field on WorkspaceState, including the multi-select fields App never
  // reads), so App — the root of the whole tree — re-rendered on any change
  // to any of those stores anywhere in the app. useShallow keeps the same
  // destructured shape while only re-rendering when one of these fields
  // itself changes.
  const {
    rootPath,
    setRootPath,
    setFileTree,
    recentWorkspaces,
    recentWorkspacesLoaded,
    fileTree,
    expandedPaths,
    expandAllFolders,
    loadRecentWorkspaces,
  } = useWorkspaceStore(
    useShallow((s) => ({
      rootPath: s.rootPath,
      setRootPath: s.setRootPath,
      setFileTree: s.setFileTree,
      recentWorkspaces: s.recentWorkspaces,
      recentWorkspacesLoaded: s.recentWorkspacesLoaded,
      fileTree: s.fileTree,
      expandedPaths: s.expandedPaths,
      expandAllFolders: s.expandAllFolders,
      loadRecentWorkspaces: s.loadRecentWorkspaces,
    }))
  );
  const {
    openFile,
    openTab,
    markSaved,
    openTabs,
    activeTabPath,
    closeTab,
    closeTabsByPath,
    toggleOutline,
    splitPane,
    closeSplit,
    isSplit,
  } = useEditorStore(
    useShallow((s) => ({
      openFile: s.openFile,
      openTab: s.openTab,
      markSaved: s.markSaved,
      openTabs: s.openTabs,
      activeTabPath: s.activeTabPath,
      closeTab: s.closeTab,
      closeTabsByPath: s.closeTabsByPath,
      toggleOutline: s.toggleOutline,
      splitPane: s.splitPane,
      closeSplit: s.closeSplit,
      isSplit: s.isSplit,
    }))
  );
  const { runHistory, completeRun } = useWorkflowStore(
    useShallow((s) => ({
      runHistory: s.runHistory,
      completeRun: s.completeRun,
    }))
  );
  const navigationDepth = useAppNavigationStore((s) => s.stack.length);
  const pushNavigationEntry = useAppNavigationStore((s) => s.push);
  const popNavigationEntry = useAppNavigationStore((s) => s.pop);
  const pushNavigationSnapshot = useCallback(() => {
    const matterState = useMatterStore.getState();
    const selection = readSelectionPresentation();
    pushNavigationEntry({
      rootPath,
      sidebarActiveTab,
      activeMatterId: selection.matterId,
      ...(selection.authorityEnabled
        ? {
            selectionScope: selection.scope,
            selectionFollowerStatus: selection.followerStatus,
          }
        : {}),
      clientMapHubId: matterState.clientMapHubId,
      clientMapHubTab: matterState.clientMapHubTab,
      documentsView,
      activeTabPath: activeTabPath ?? null,
      mattersSurfaceMode,
    });
  }, [
    activeTabPath,
    documentsView,
    mattersSurfaceMode,
    pushNavigationEntry,
    rootPath,
    sidebarActiveTab,
  ]);
  const openSettingsPage = useCallback(
    (category?: SettingCategory) => {
      if (sidebarActiveTab !== 'settings') {
        pushNavigationSnapshot();
      }
      setSettingsPageFocus((prev) => ({
        key: prev.key + 1,
        ...(category ? { category } : {}),
      }));
      setSidebarActiveTab('settings');
    },
    [pushNavigationSnapshot, sidebarActiveTab]
  );
  const openSchedulingPage = useCallback(() => {
    if (sidebarActiveTab !== 'scheduling') {
      pushNavigationSnapshot();
    }
    setSidebarActiveTab('scheduling');
  }, [pushNavigationSnapshot, sidebarActiveTab]);
  const handleAppBack = useCallback(() => {
    const snapshot = popNavigationEntry();
    if (!snapshot) return;
    const safeSnapshot = sanitizeNavigationSnapshotForCurrentMatters(
      snapshot,
      matters,
      rootPath
    );
    if (!safeSnapshot) return;
    const request = (() => {
      if (!safeSnapshot.selectionScope) {
        return safeSnapshot.activeMatterId
          ? issueMatterScopeSelection(safeSnapshot.activeMatterId)
          : issueAllMattersScopeSelection();
      }
      switch (safeSnapshot.selectionScope.kind) {
        case 'matter':
        case 'matter-only':
          return issueMatterScopeSelection(safeSnapshot.selectionScope.matterId);
        case 'all-matters':
          return issueAllMattersScopeSelection();
        case 'blocked-unresolved':
          return null;
      }
    })();
    if (!request) return;
    void requestMatterScopeSelection(request)
      .then((result) => {
        if (result.kind === 'refused') return;
        const matterState = useMatterStore.getState();
        matterState.setClientMapHubId(safeSnapshot.clientMapHubId);
        matterState.setClientMapHubTab(safeSnapshot.clientMapHubTab);
        setMattersSurfaceMode(safeSnapshot.mattersSurfaceMode);
        setDocumentsView(safeSnapshot.documentsView);
        if (
          safeSnapshot.activeTabPath &&
          useEditorStore
            .getState()
            .openTabs.some((tab) => tab.path === safeSnapshot.activeTabPath)
        ) {
          useEditorStore.getState().setActiveTab(safeSnapshot.activeTabPath);
        }
        setSidebarActiveTab(safeSnapshot.sidebarActiveTab);
      })
      .catch((error: unknown) => {
        console.error('[App navigation] Back scope restoration failed.', error);
      });
  }, [matters, popNavigationEntry, rootPath]);
  // The global Back button was removed from the UI by the 2026-07-07 chrome
  // pass. Keep the navigation machinery compiled for future non-button entry
  // points without rendering the old button.
  void navigationDepth;
  void handleAppBack;

  // M1 (v1.5) Memory: install the workspace RAG indexer once we know
  // which workspace is open. Watches `rootPath` and re-arms on switch.
  // M3 (v1.5) Facts: the same hook wires the FactsService singleton
  // to the active workspace via the WorkspaceService ref.
  useMemoryWiring(rootPath, workspaceServiceRef.current);

  // BUG-038/039/083: the external MCP sidecar cannot read React state or
  // browser localStorage, so the desktop app writes a tiny scope file inside the
  // workspace. The sidecar reads it on EVERY request and fails closed when it is
  // missing or invalid. External MCP clients see only the matters the user has
  // explicitly granted in matter management; the active matter is written for
  // UI context only and never counts as permission.
  useEffect(() => {
    const service = workspaceServiceRef.current;
    if (!service || !rootPath) return;
    const persistMcpScope = (): void => {
      void writeMcpSessionScopeFile({
        service,
        workspaceRoot: rootPath,
        selectionScope: selectionPresentation.scope,
        selectionFollowerStatus: selectionPresentation.followerStatus,
        matters,
        // The sidecar derives from the same confirmed native enforcement as
        // connector UI. Unknown/pending stays fail-closed, never from the
        // saved privacy choice that merely requested the transition.
        networkLockdown: enforcedNetworkLockdown.blocked,
      }).catch((err: unknown) => {
        console.warn('[MCP] Failed to write session scope file', err);
      });
    };
    persistMcpScope();
    const heartbeat = window.setInterval(persistMcpScope, 15_000);
    return () => {
      window.clearInterval(heartbeat);
      void writeDenyAllMcpSessionScopeFile({
        service,
        workspaceRoot: rootPath,
      }).catch((err: unknown) => {
        console.warn('[MCP] Failed to write deny-all session scope file', err);
      });
    };
  }, [
    rootPath,
    activeMatterId,
    selectionPresentation.scope,
    selectionPresentation.followerStatus,
    matters,
    enforcedNetworkLockdown.blocked,
  ]);

  // Keep the AI ambient file-context store in sync with whatever tabs are
  // open. Mounted at App level so a single subscription drives every chat.
  useOpenFileAIContext();

  // UX-26: full-text content index across the workspace. Builds once per
  // workspace open; per-file updates flow through the returned `upsert`.
  // We pass the service from the ref (not reactive) — the hook rebuilds
  // when rootPath changes, so a switch wire-up gives us a fresh index.
  const contentIndex = useContentIndex({
    rootPath,
    service: workspaceServiceRef.current,
    fileTree,
  });

  // G5: Feed decrypted mail text into the in-memory MiniSearch index via the
  // mail-index-chunk Tauri event. The decrypted text never touches disk —
  // it lives only in the renderer process's MiniSearch instance.
  // Stable identity (useCallback) so useMailSync subscribes once and does not
  // tear down / re-create the listener on every render (which would drop chunks
  // fired during an active sync).
  const handleMailChunk = useCallback(
    (chunk: MailIndexChunk) => {
      contentIndex.upsert({
        id: `mail:${chunk.docId}`,
        path: `mail:${chunk.docId}`,
        name: chunk.subject || 'Email',
        content: chunk.decryptedText,
      });
    },
    [contentIndex.upsert]
  );
  useMailSync({ onMailChunk: handleMailChunk });
  // Single-mount: write a durable audit row for every terminal mail-sync outcome
  // (done / error / cancelled), per provider. Lives at the app root so exactly
  // one row is written per event — never duplicated per connector panel.
  useMailSyncAudit();

  // Shared KeychainService for every API-key surface: the first-run wizard's
  // "connect an AI" step, the "Manage AI Account Keys" manager, AND the live
  // in-memory key state (useApiKeys). One instance keeps the key metadata
  // consistent across all of them. KeychainService.setKey/getKey/deleteKey use
  // the OS keychain in Tauri and obfuscated localStorage in browser-only dev —
  // the raw key is NEVER written to plain localStorage.
  // Lazy useState (not useRef): this singleton is created exactly once and never
  // reassigned, so reading it during render is safe — and lazy init avoids the
  // wasteful per-render `new KeychainService()` (whose constructor runs
  // loadMetadata) that useRef(createKeychainService()) incurred. Satisfies
  // react-hooks/refs (no ref read during render).
  const [keychainService] = useState(() => createKeychainService());

  // API key management — all persistence routes through the shared keychain.
  const {
    apiKeys,
    handleSaveApiKey: rawSaveApiKey,
    handleDeleteApiKey,
    credentialServiceUnavailable,
  } = useApiKeys(keychainService);
  // QA-33: dismissible until the condition clears and re-occurs — a fresh
  // outage should be shown again even if a PRIOR one was dismissed this
  // session (e.g. the credential service flaps: down, restarts, goes down
  // again).
  const [credentialBannerDismissed, setCredentialBannerDismissed] =
    useState(false);
  useEffect(() => {
    if (!credentialServiceUnavailable) setCredentialBannerDismissed(false);
  }, [credentialServiceUnavailable]);

  // Model list auto-fetching
  const validKeyEntries = useMemo(
    () =>
      apiKeys
        .filter((k) => k.isValid)
        .map((k) => ({ provider: k.provider, key: k.key })),
    [apiKeys]
  );
  const { refreshProvider } = useModelList(validKeyEntries);

  // Wrap the API key save handler to also refresh the model list. The save
  // itself persists through the shared keychain (useApiKeys.handleSaveApiKey),
  // so a bad-format / rejected key throws here and propagates to the caller.
  const handleSaveApiKey = useCallback(
    async (provider: 'anthropic' | 'openai' | 'google', key: string) => {
      await rawSaveApiKey(provider, key);
      // Fire-and-forget: refreshing the model list shouldn't block the save.
      void refreshProvider(provider, key);
    },
    [rawSaveApiKey, refreshProvider]
  );

  // One-time cleanup: move any legacy plaintext `apiKey_<provider>` entries
  // written by older builds into the keychain, then delete the plaintext.
  useEffect(() => {
    void migrateLocalStorageApiKeysToKeychain();
  }, []);

  // Persist a key entered during onboarding through the canonical keychain
  // path (single secure write — no plaintext mirror) and reflect it in the
  // live API-key state + model list so the AI pane sees the connected provider
  // immediately. A bad-format key throws here so the wizard's AI step surfaces
  // the error and stays put.
  const handleSaveOnboardingApiKey = useCallback(
    async (provider: 'anthropic' | 'openai' | 'google', key: string) => {
      await handleSaveApiKey(provider, key);
    },
    [handleSaveApiKey]
  );

  // After "Manage AI Account Keys" removes a key from the keychain, clear the
  // mirrored in-memory apiKeys array so the AI pane immediately stops offering
  // that provider. handleDeleteApiKey also removes it from the keychain (an
  // idempotent no-op if the manager already deleted it).
  const handleRemoveApiKey = useCallback(
    (provider: 'anthropic' | 'openai' | 'google') => {
      void handleDeleteApiKey(provider);
    },
    [handleDeleteApiKey]
  );

  // Trash management
  const {
    trashItems,
    trashStats,
    trashRetentionPeriod,
    trashCustomRetentionDays,
    saveTrashMetadata,
    loadTrashMetadata,
    handleRestoreFromTrash,
    handlePermanentDelete,
    handleEmptyTrash,
    handleTrashRetentionChange,
    setTrashItems,
    setTrashStats,
  } = useTrash({ rootPath, workspaceServiceRef });

  // Confirmation dialogs
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  // Prompt dialogs
  const { prompt, dialogProps: promptDialogProps } = usePromptDialog();

  // UX-16: undo toast controller for destructive actions (delete/rename).
  const undoToast = useUndoToast();

  // UX-16: in-session rename history per-file so Ctrl+Z can revert the
  // most recent rename. The value is an array of { fromPath, toPath }
  // tuples in the order they happened; popping the tail gives us the
  // last rename to undo. We don't persist this across app reloads —
  // "session" is literally the current tab's lifetime.
  const renameHistoryRef = useRef<Array<{ fromPath: string; toPath: string }>>(
    []
  );

  // UX-29: session-scoped delete history so Ctrl+Z can restore the most
  // recent deletion. We keep just the trash `id` — `handleRestoreFromTrash`
  // resolves it back to the original path. The combined `undoStackRef`
  // below records the order of destructive actions so Ctrl+Z always undoes
  // the most recent of any kind.
  const deleteHistoryRef = useRef<Array<string>>([]);
  const undoStackRef = useRef<Array<'rename' | 'delete'>>([]);

  // Auto-expand all folders when file tree is first loaded or changes
  useEffect(() => {
    if (fileTree.length > 0 && expandedPaths.size === 0 && rootPath) {
      // File tree exists but nothing is expanded - expand all folders
      const timer = setTimeout(() => {
        expandAllFolders();
        console.log('Auto-expanded all folders on file tree load');
      }, 100); // Small delay to ensure React state is updated
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [fileTree, expandedPaths.size, expandAllFolders, rootPath]);

  // File system watcher - auto-refresh when external changes detected
  useEffect(() => {
    if (!rootPath || !workspaceServiceRef.current) {
      // No workspace loaded, stop any existing watcher
      if (fileSystemWatcherRef.current) {
        fileSystemWatcherRef.current.stop();
        fileSystemWatcherRef.current = null;
      }
      return;
    }

    // Create and start watcher. `pollInterval` only applies to the browser
    // fallback (no OS file-change events there) — the default (30s) is used;
    // on Tauri the watcher subscribes to native events instead of polling.
    const watcher = new FileSystemWatcher({
      onFileTreeChange: async () => {
        console.log(
          'FileSystemWatcher: External file changes detected, refreshing file tree...'
        );
        if (workspaceServiceRef.current) {
          try {
            // P1.1 (Task 6): force a real scan here — this fires when the watcher
            // detected an EXTERNAL change, so a cached tree would be stale.
            const newFileTree = await workspaceServiceRef.current.getFileTree({
              fresh: true,
            });
            setFileTree(newFileTree);
          } catch (error) {
            console.error(
              'FileSystemWatcher: Failed to refresh file tree:',
              error
            );
          }
        }
      },
    });

    // Start watching. On Tauri this starts/confirms the native watcher for
    // rootPath and subscribes to its `workspace-file-changed` event (no
    // polling); the snapshot getter below is only used by the browser poll
    // fallback.
    void watcher.start(rootPath, async () => {
      if (!workspaceServiceRef.current) return '';
      try {
        // P1.1 (Task 6): the browser fallback's change-detection poll MUST see
        // the real current tree (a cached read could never detect an external
        // change), and this fresh scan also keeps the shared cache warm.
        const currentTree = await workspaceServiceRef.current.getFileTree({
          fresh: true,
        });
        return createFileTreeSnapshot(currentTree);
      } catch (error) {
        console.error(
          'FileSystemWatcher: Failed to get file tree snapshot:',
          error
        );
        return '';
      }
    });

    fileSystemWatcherRef.current = watcher;

    // Cleanup on unmount or workspace change
    return () => {
      if (fileSystemWatcherRef.current) {
        fileSystemWatcherRef.current.stop();
        fileSystemWatcherRef.current = null;
      }
    };
  }, [rootPath, setFileTree]);

  useTestModeWorkspace({
    isTestMode: IS_LEGACY_TEST_MODE,
    rootPath,
    setRootPath,
    openFile,
    setFileTree,
    expandAllFolders,
    workspaceServiceRef,
  });

  // Load recent workspaces from localStorage on mount
  useEffect(() => {
    loadRecentWorkspaces();
  }, [loadRecentWorkspaces]);

  // Stream C1 Group VIII — Deferred check-for-updates on workspace load.
  //
  // We subscribe to the templates marketplace store rather than reading a ref
  // so the check re-runs each time the user switches workspaces (each
  // workspace gets its own MarketplaceService instance with its own install
  // root). The 2-second delay keeps cold start snappy by skipping the network
  // round trip until the editor is interactive. Errors are swallowed: a
  // failed network call leaves the badge at 0 and the user can still install
  // / refresh by hand.
  useEffect(() => {
    const status = { cancelled: false };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleCheck = (svc: MarketplaceService) => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        if (status.cancelled) return;
        void (async () => {
          try {
            const updates = await svc.checkForUpdates();
            if (status.cancelled) return;
            useTemplatesMarketplaceStore
              .getState()
              .setUpdateCount(updates.length);
          } catch (err) {
            console.warn(
              '[App] checkForUpdates failed; badge remains hidden:',
              err
            );
          }
        })();
      }, 2000);
    };
    const unsubscribe = useTemplatesMarketplaceStore.subscribe(
      (state, prev) => {
        if (state.service === prev.service) return;
        if (!state.service) {
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
          useTemplatesMarketplaceStore.getState().setUpdateCount(0);
          return;
        }
        scheduleCheck(state.service);
      }
    );
    // Run once for the current state too (subscribe only fires on change).
    const current = useTemplatesMarketplaceStore.getState().service;
    if (current) scheduleCheck(current);
    return () => {
      status.cancelled = true;
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  // Handle file open (must be defined before useSourceCards)
  const handleFileOpen = useCallback(
    async (path: string, name: string) => {
      if (!workspaceServiceRef.current) return false;

      // Auto-expand parent folders to show file location
      const { expandedPaths, setExpandedPaths } = useWorkspaceStore.getState();
      const parts = path.split('/');
      const newExpanded = new Set(expandedPaths);

      // Add all parent folder paths to expanded set
      for (let i = 1; i < parts.length - 1; i++) {
        const folderPath = parts.slice(0, i + 1).join('/');
        newExpanded.add(folderPath);
      }

      // Update expanded paths if any new folders were added
      if (newExpanded.size > expandedPaths.size) {
        setExpandedPaths(newExpanded);
      }

      try {
        if (isBinaryFile(name)) {
          // Read binary content for binary files (images, videos, PDFs, etc.)
          const buffer = await workspaceServiceRef.current.readFileBinary(path);
          const mimeType = getMimeType(name);
          const dataUrl = arrayBufferToDataUrl(buffer, mimeType);
          openFile(path, name, dataUrl);
          setDocumentsView('editor');
          return true;
        } else {
          const content = await workspaceServiceRef.current.readFile(path);
          // `.workflow` files are routed via openTab with the dedicated
          // type so MainPanel's extension-based dispatch + the dedup logic
          // both see a stable type and re-clicks from the tree refresh
          // the in-memory content rather than dropping the tab type.
          if (isWorkflowFilePath(path)) {
            openTab(path, name, content, 'workflow-execution');
          } else {
            openFile(path, name, content);
          }
          setDocumentsView('editor');
          return true;
        }
      } catch (error) {
        console.error('Failed to open file:', error);
        window.alert(
          "I couldn't open that file. It may have been moved, or it's too large to preview."
        );
        return false;
      }
    },
    [openFile, openTab]
  );

  // Source card management (must be defined before handleWorkspaceSelected)
  const { setSourceCards, loadSourceCards } = useSourceCards({
    rootPath,
    workspaceServiceRef,
    handleFileOpen,
  });

  // Handle delete (moves to trash instead of permanent delete) - must be defined before useAIChatFiles
  const handleDelete = useCallback(
    async (path: string) => {
      const fileName = path.split('/').pop() ?? 'unknown';
      const confirmed = await confirm(
        `Are you sure you want to delete "${fileName}"?`,
        {
          title: 'Delete File',
          variant: 'destructive',
          confirmLabel: 'Delete',
        }
      );
      if (!confirmed || !workspaceServiceRef.current || !rootPath) return;

      try {
        // Get file stats for trash entry
        const stat = await workspaceServiceRef.current.stat(path);

        // Create trash folder if it doesn't exist
        const trashFolderPath = workspacePath(rootPath, '.trash');
        const trashExists =
          await workspaceServiceRef.current.exists(trashFolderPath);
        if (!trashExists) {
          await workspaceServiceRef.current.mkdir(trashFolderPath);
        }

        // Move file to trash with timestamp prefix
        const timestamp = Date.now();
        const trashPath = `${trashFolderPath}/${timestamp}_${fileName}`;
        await workspaceServiceRef.current.move(path, trashPath);

        // Create trash item entry
        const trashedItem: TrashedItem = {
          id: `trash_${timestamp}_${Math.random().toString(36).slice(2, 9)}`,
          originalPath: path,
          trashPath,
          name: fileName,
          type: stat.type,
          deletedAt: new Date(),
          size: stat.size,
        };

        // Update trash state and persist
        const newItems = [trashedItem, ...trashItems];
        setTrashItems(newItems);

        // Update stats
        const totalSize = newItems.reduce(
          (sum, item) => sum + (item.size ?? 0),
          0
        );
        const firstDeletedAt = newItems[0]?.deletedAt;
        const oldestItem = firstDeletedAt
          ? newItems.reduce(
              (oldest, item) =>
                item.deletedAt < oldest ? item.deletedAt : oldest,
              firstDeletedAt
            )
          : undefined;
        setTrashStats({
          itemCount: newItems.length,
          totalSize,
          oldestItem,
        });

        // Persist trash metadata
        await saveTrashMetadata(newItems);

        // Refresh file tree
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);

        // Close all tabs for the deleted file (handles duplicates and split panes)
        closeTabsByPath(path);

        // UX-26: drop from the content index so stale hits don't linger.
        contentIndex.remove(path);

        // UX-16: 10-second undo toast. Clicking Undo restores the file
        // from Trash to its original path. Auto-dismissing commits the
        // destructive action (no extra confirmation required).
        undoToast.show({
          message: `"${fileName}" moved to Trash`,
          ttlMs: 10_000,
          onUndo: async () => {
            try {
              await handleRestoreFromTrash(trashedItem.id);
              // UX-29: once undone via the toast, drop the corresponding
              // entry so Ctrl+Z doesn't try to restore it a second time.
              const idx = deleteHistoryRef.current.lastIndexOf(trashedItem.id);
              if (idx >= 0) deleteHistoryRef.current.splice(idx, 1);
              const stackIdx = undoStackRef.current.lastIndexOf('delete');
              if (stackIdx >= 0) undoStackRef.current.splice(stackIdx, 1);
            } catch (err) {
              console.error('Failed to undo delete:', err);
            }
          },
        });

        // UX-29: record the deletion on the session-scoped delete history
        // so Ctrl+Z can restore it even after the toast has expired
        // (within the same session).
        deleteHistoryRef.current.push(trashedItem.id);
        undoStackRef.current.push('delete');
      } catch (error) {
        console.error('Failed to delete:', error);
        window.alert(
          "I couldn't move that to Trash. Check that your workspace has space, then try again."
        );
      }
    },
    [
      setFileTree,
      rootPath,
      closeTabsByPath,
      trashItems,
      saveTrashMetadata,
      setTrashStats,
      setTrashItems,
      confirm,
      undoToast,
      handleRestoreFromTrash,
      contentIndex,
    ]
  );

  // AI Chat Files Management (must be defined after handleDelete and handleFileOpen)
  const { setChatFiles, loadChatFiles } = useAIChatFiles({
    rootPath,
    workspaceServiceRef,
    handleFileOpen,
    handleDelete,
  });

  // Handle workspace selection and recent-project opening (extracted to hook)
  const {
    handleWorkspaceSelected,
    handleOpenRecentProject,
    workspaceOpenError,
    dismissWorkspaceOpenError,
  } = useWorkspaceLifecycle({
    workspaceServiceRef,
    auditServiceRef,
    templatesMarketplaceServiceRef,
    templatesMetadataReaderRef,
    setShowWorkspaceSelector,
    setAuditEntries,
    setAuditIntegrity,
    setRootPath,
    loadTrashMetadata,
    setTrashItems,
    setTrashStats,
    loadSourceCards,
    setSourceCards,
    loadChatFiles,
    setChatFiles,
    confirm,
  });

  useEffect(() => registerFirmWorkspaceSwitcher(handleWorkspaceSelected), [handleWorkspaceSelected]);

  // Boot: silently reopen the last workspace when "Reopen last workspace" is
  // on, instead of always showing the picker (only Tauri can do this without
  // a fresh user gesture — browser directory handles need a picker click).
  // See useAutoResumeWorkspace for why this waits on explicit hydration
  // flags rather than reading the stores synchronously at mount, and for the
  // hang- and vault-safety guarantees below.
  const settingsHydrated = useSettingsHydrated();
  // Fix 1 (demo readiness): if Local-only is already the persisted mode, warm
  // up the llama-server sidecar now instead of waiting for the first
  // post-launch question. See usePreStartLocalAi for the hydration-race note.
  usePreStartLocalAi(settingsHydrated);
  const startupBehavior = useSettingsStore((s) =>
    s.getSetting<string>('startupBehavior')
  );
  // A locked vault needs WorkspaceSelector's own VaultLockedPrompt UI to
  // unlock, so auto-resume must never silently open one — it preflights with
  // the SAME vaultStatus() check WorkspaceSelector's manual open path uses,
  // bounded by a short timeout (this is a UX preflight, not the security
  // boundary, so it fails OPEN — i.e. "not locked" — on its own error/timeout,
  // same as WorkspaceSelector's non-fatal catch for this call).
  const isWorkspaceVaultLocked = useCallback(
    async (path: string): Promise<boolean> => {
      if (!isTauriEnvironment()) return false;
      try {
        const status = await withTimeout(
          vaultStatus(path),
          5_000,
          'Checking vault status'
        );
        return status.enabled && status.locked;
      } catch {
        return false;
      }
    },
    []
  );
  const isAutoResumingWorkspace = useAutoResumeWorkspace({
    isEligibleEnvironment:
      !IS_TEST_MODE &&
      !IS_DEMO_MODE &&
      (!EXPLICIT_LAUNCH_WORKSPACE || explicitLaunchDecisionComplete) &&
      !explicitWorkspaceForFirstRun &&
      isTauriEnvironment(),
    settingsHydrated,
    recentWorkspacesLoaded,
    startupBehavior,
    recentWorkspaces,
    activeWorkspacePath: rootPath,
    isWorkspaceVaultLocked,
    openWorkspace: handleOpenRecentProject,
  });

  // First-run workspace-first step. The onboarding overlay (OnboardingV2) calls
  // this BEFORE its connect/Client-Map steps so a workspace always exists by the
  // time connectors/import/Client-Map need one (Cluster-3 "workspace must be
  // step 0"). It reuses the same folder-pick + create flow the Workspace
  // Selector uses; for the 'sample' mode it then writes the advisor sample and
  // seeds a fully-cited Client Map so first-run lands in a populated practice
  // instead of an empty app.
  const handleOnboardingChooseStart = useCallback(
    async (mode: OnboardingStartMode): Promise<OnboardingStartResult> => {
      try {
        // 1. Establish a workspace unless one is already open.
        const existingService = workspaceServiceRef.current;
        const existingRoot = useWorkspaceStore.getState().rootPath;
        let service: WorkspaceService;
        let root: string;
        if (existingService && existingRoot) {
          service = existingService;
          root = existingRoot;
        } else {
          let backend;
          let chosen: string;
          if (isTauriEnvironment()) {
            const { open: openDialog } =
              await import('@tauri-apps/plugin-dialog');
            const raced = await raceDialogWithWatchdog(
              openDialog({
                directory: true,
                multiple: false,
                title:
                  mode === 'sample'
                    ? 'Choose a folder for your sample practice'
                    : 'Choose your practice folder',
              })
            );
            // QA-32: the native folder picker can silently never respond on
            // some environments (see dialogWatchdog.ts) — fall back to a
            // manual path entry instead of leaving onboarding stuck forever.
            let selected: string | null;
            if (!raced.timedOut) {
              selected = raced.value;
            } else {
              console.warn(
                '[App] Native folder picker did not respond within the watchdog window — falling back to manual path entry.'
              );
              selected = await prompt(
                mode === 'sample'
                  ? t('onboarding.workspace-picker.picker-unresponsive-sample')
                  : t(
                      'onboarding.workspace-picker.picker-unresponsive-own-data'
                    ),
                '',
                {
                  title: t('workspace.selector.manual-path-title'),
                  placeholder: t('workspace.selector.manual-path-placeholder'),
                }
              );
            }
            if (!selected) return { ok: false, cancelled: true };
            chosen = selected;
          } else {
            const webBackend = createWebFSBackend();
            const handle = await webBackend.openDirectoryPicker();
            backend = webBackend;
            chosen = '/' + handle.name;
          }
          // Keep this path in lockstep with WorkspaceSelector's new-workspace
          // flow. The old onboarding-only version opened strictly, skipped the
          // readability check, and had no timeout around native setup. An
          // empty chosen folder could therefore leave this scene's busy state
          // waiting on a never-settling native call instead of surfacing an
          // honest retryable error.
          const svc = await withTimeout(
            (async () => {
              const selectedBackend = isTauriEnvironment()
                ? await createFSBackend(chosen, { createIfMissing: true })
                : backend;
              if (!selectedBackend) {
                throw new Error('Could not prepare the selected workspace folder.');
              }
              const candidate = createWorkspaceService();
              await candidate.initialize(selectedBackend, chosen, {
                createIfMissing: true,
                createDefaultStructure: true,
              });
              await candidate.getFileTree();
              return candidate;
            })(),
            ONBOARDING_WORKSPACE_OPEN_TIMEOUT_MS,
            ONBOARDING_WORKSPACE_OPEN_LABEL,
          );
          // Wire the workspace into the app (sets rootPath, audit, file tree...).
          // The handler can abort (unsaved-changes guard on an already-open
          // workspace); treat that as the user cancelling this onboarding step.
          const committed = await handleWorkspaceSelected(svc);
          if (!committed) return { ok: false, cancelled: true };
          const opened = svc.getRootPath();
          if (!opened) {
            return {
              ok: false,
              error: "I couldn't open a workspace. Please try again.",
            };
          }
          service = svc;
          root = opened;
        }

        // NB: registering the workspace in Recents is NOT done here anymore.
        //     It is now done canonically inside handleWorkspaceSelected (see
        //     useWorkspaceLifecycle.ts), the shared lifecycle boundary that
        //     reliably runs for BOTH this onboarding path AND the normal
        //     Workspace Selector open. A prior fix called addRecentWorkspace
        //     right here, but on the real Windows first-run flow that call
        //     never fired (its `[RecentWorkspaces] Saved` log never appeared),
        //     so the first-run gate stayed unsatisfied and the sample path
        //     looped back to the intro. Moving it to the lifecycle boundary
        //     fixes that. The `existingService && existingRoot` fast-path above
        //     also flows through handleWorkspaceSelected on its original open,
        //     so it is already in Recents by the time we reach here.

        // 2. Sample path: write the Hendricks sample + seed its Client Map so
        //    the Client Map tab is populated in minute one (no AI/network).
        if (mode === 'sample') {
          // Make the reactive profession 'advisor' so the sample matter is named
          // "The Hendricks Household" and the right pack/copy is used.
          useProfessionStore.getState().setProfession('advisor');
          await writeSampleFiles(service, 'advisor');
          const matter = getOrCreateSampleMatter(root);
          await seedSampleClientMap(matter.id);
          // Golden-path extras (sample meeting, prep brief, CRM card) are
          // garnish — a seeding failure must never fail the sample start
          // itself, so it is caught and logged instead of bubbling.
          try {
            await seedSampleGoldenPath(service, root, matter.id);
          } catch (seedErr) {
            console.warn('[onboarding] sample golden-path seeding failed (continuing):', seedErr);
          }
          setSidebarActiveTab('matters');
          // NB: the setup-progress Client Map count intentionally EXCLUDES sample
          // matters (see computeClientMapProgress), so we don't try to report the
          // seeded sample as 1/1 there — it would be recomputed to 0/0 on mount.
          // The Firm-setup callout's honest "builds when you open each client"
          // note covers this; the user lands directly on the seeded map anyway.
        }
        return { ok: true, mode };
      } catch (err) {
        // A cancelled browser folder picker throws AbortError — treat as cancel.
        if (err instanceof Error && err.name === 'AbortError') {
          return { ok: false, cancelled: true };
        }
        return {
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : 'Something went wrong opening your workspace.',
        };
      }
    },
    [handleWorkspaceSelected, prompt, t]
  );

  // Demo build (lantern.com/try): auto-open the OPFS workspace that
  // WebDemoSeeder pre-populated, so the visitor lands inside the seeded
  // matter instead of the "pick a folder" screen. Mirrors the browser
  // open path in WorkspaceSelector, but sources the directory handle from
  // OPFS rather than a user folder picker.
  useEffect(() => {
    if (!IS_DEMO_MODE || rootPath) return;
    const cancelled = { current: false };
    void (async () => {
      try {
        const opfsRoot = await navigator.storage.getDirectory();
        const demoDir = await opfsRoot.getDirectoryHandle('lantern-demo', {
          create: true,
        });
        const backend = createWebFSBackend();
        backend.setRootHandle(demoDir);
        const service = createWorkspaceService();
        await service.initialize(backend, '/lantern-demo');
        if (cancelled.current) return;
        await handleWorkspaceSelected(service);
      } catch (err) {
        console.error('[App] demo workspace auto-open failed:', err);
        if (!cancelled.current) setDemoOpenFailed(true);
      }
    })();
    return () => {
      cancelled.current = true;
    };
  }, [IS_DEMO_MODE, rootPath, handleWorkspaceSelected]);

  // Tab opening: browser tabs, AI assistant tab, and email-listener wiring
  // (extracted to useTabOpening)
  const { handleOpenBrowserTab, openAIAssistantTab } = useTabOpening({
    openTab,
    setSidebarActiveTab,
    setDocumentsView,
    pushNavigationSnapshot,
  });

  // Shell-wide `lantern:*` CustomEvent wiring (matter manager, settings,
  // account, matter launch). See src/app/lifecycle/useGlobalEventBus.ts.
  useGlobalEventBus({
    onOpenMatterManager: () => {
      setNewClientOpen(true);
    },
    onOpenClientSettings: (matterId: string | null) => {
      setClientSettingsMatterId(matterId);
      setMatterManagerOpen(true);
    },
    onOpenNewGroup: () => {
      setNewGroupOpen(true);
    },
    onOpenAccount: (tab?: string) => {
      setAccountWindowInitialTab(tab);
      setAccountWindowOpen(true);
    },
    openSettings,
    openSettingsPage,
    isAppShellAvailable: Boolean(rootPath) && !showWorkspaceSelector && !showFirstRun,
    setSidebarActiveTab,
    setDocumentsView,
    setAskPrefill,
    setMattersSurfaceMode,
    pushNavigationSnapshot,
  });

  // Per-matter UI memory: as the user works inside a matter, keep its snapshot
  // (last working surface + focused document) up to date, so returning to the
  // matter later restores it. Hub/Settings are NOT remembered (browse/config),
  // so opening a matter's hub never clobbers its remembered work.
  useEffect(() => {
    if (!activeMatterId) return;
    if (!isWorkingSurface(sidebarActiveTab)) return;
    useMatterUiStore.getState().saveSnapshot(activeMatterId, {
      surface: sidebarActiveTab,
      activeTabPath:
        sidebarActiveTab === 'files' ? (activeTabPath ?? null) : null,
    });
  }, [activeMatterId, sidebarActiveTab, activeTabPath]);

  const {
    writeTabContent,
    handleSaveFile,
    handleCreateFile,
    handleCreateFolder,
    handleRename,
    handleRenameWithName,
    handleDownload,
    refreshFileTree,
    handleMove,
  } = useFileOperations({
    workspaceServiceRef,
    fileSystemWatcherRef,
    handleFileOpen,
    prompt,
    setFileTree,
    markSaved,
    contentIndex,
    openTabs,
    closeTab,
    renameHistoryRef,
    undoStackRef,
  });

  const {
    handleCreateTextFileAtRoot,
    handleSetLetterheadTemplate,
    handleCreateDocxAtRoot,
    handleCreateDefaultDocument,
    handleCreateFolderAtRoot,
  } = useDocumentCreation({
    workspaceServiceRef,
    rootPath,
    setFileTree,
    prompt,
    confirm,
    handleFileOpen,
    openFile,
  });

  // BUG-060 (batch mode): give the end-of-turn batch-review panel the live
  // workspace fs so it can undo applied AI changes, plus a refresh hook so the
  // file tree updates after an undo. The adapter reads the ref lazily at undo
  // time, so it stays valid across workspace switches.
  useEffect(() => {
    useAiBatchReviewStore.getState().setUndoFs(
      {
        writeFileBinary: (p, b) => {
          const svc = workspaceServiceRef.current;
          if (!svc) throw new Error('Workspace not initialized');
          return svc.writeFileBinary(p, b);
        },
        delete: (p) => {
          const svc = workspaceServiceRef.current;
          if (!svc) throw new Error('Workspace not initialized');
          return svc.delete(p);
        },
        move: (f, to) => {
          const svc = workspaceServiceRef.current;
          if (!svc) throw new Error('Workspace not initialized');
          return svc.move(f, to);
        },
        exists: (p) => {
          const svc = workspaceServiceRef.current;
          if (!svc) throw new Error('Workspace not initialized');
          return svc.exists(p);
        },
      },
      () => {
        void refreshFileTree();
      }
    );
  }, [refreshFileTree]);

  // BUG-060 (batch mode): if the workspace changes, drop any pending batch
  // review. Its changes were applied to the OLD workspace and its absolute
  // paths don't belong to the new one, so undoing here would be unsafe. The
  // changes stay on the old workspace's disk (already applied) + in the audit
  // log; we only drop the now-unsafe undo affordance.
  useEffect(() => {
    useAiBatchReviewStore.getState().reset();
  }, [rootPath]);

  // Audit log helper - logs all AI actions to the audit log.
  //
  // Persists through the AuditService (encrypted-at-rest on desktop,
  // localStorage in the browser) AND mirrors the entry into the live React
  // state the AuditLog renders. We let the service mint the id/timestamp so the
  // persisted row and the on-screen row describe the same event. Append-only on
  // both sides: we only ever prepend a new entry.
  const addAuditEntry = useCallback(
    async (
      entry: AuditWriteEntry,
      requirePersistence = false
    ): Promise<AuditEntry> => {
      const options = {
        ...(entry.model !== undefined ? { model: entry.model } : {}),
        inputs: entry.inputs,
        outputs: entry.outputs,
        ...(entry.userDecision !== undefined
          ? { userDecision: entry.userDecision }
          : {}),
        metadata: entry.metadata,
        ...(entry.tokensIn !== undefined
          ? { tokensIn: entry.tokensIn }
          : {}),
        ...(entry.tokensOut !== undefined
          ? { tokensOut: entry.tokensOut }
          : {}),
        ...(entry.costUsd !== undefined ? { costUsd: entry.costUsd } : {}),
        ...(entry.provider !== undefined
          ? { provider: entry.provider }
          : {}),
      };
      if (
        requirePersistence ||
        entry.metadata['auditMustPersist'] === true
      ) {
        const newEntry = await auditServiceRef.current.mustLogDurable(
          entry.action,
          entry.description,
          options,
        );
        setAuditEntries((prev) => [newEntry, ...prev]);
        try {
          setAuditIntegrity(await auditServiceRef.current.verifyIntegrity());
        } catch {
          // The action audit already persisted; integrity refresh is best-effort UI.
        }
        return newEntry;
      }
      const { entry: newEntry, persisted } =
        auditServiceRef.current.logDurablePending(
          entry.action,
          entry.description,
          options
        );
      setAuditEntries((prev) => [newEntry, ...prev]);
      void persisted
        .then((settledEntry) => {
          setAuditEntries((prev) =>
            prev.map((existing) =>
              existing.id === settledEntry.id
                ? { ...settledEntry, metadata: { ...settledEntry.metadata } }
                : existing
            )
          );
          return auditServiceRef.current.verifyIntegrity();
        })
        .then(setAuditIntegrity)
        .catch(() => undefined);
      return newEntry;
    },
    []
  );

  // The public feature doorway is fail-closed: unlike legacy App callers, it
  // resolves only after the canonical store confirms the append. Keep this
  // separate from addAuditEntry's default pending behavior so existing
  // callbacks remain unchanged.
  const addDurableAuditEntry = useCallback(
    (entry: AuditWriteEntry): Promise<AuditEntry> =>
      addAuditEntry(entry, true),
    [addAuditEntry]
  );

  useEffect(() => {
    setAuditWriteEmitter(addDurableAuditEntry);
    return () => {
      setAuditWriteEmitter(null);
    };
  }, [addDurableAuditEntry]);

  const emitAuditEntry = useCallback(
    (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => {
      void addAuditEntry(entry);
    },
    [addAuditEntry]
  );
  // Intake's audit-emitter contracts predate addAuditEntry's async fold-in
  // (it now resolves the created AuditEntry, for callers elsewhere that
  // chain off it) and are typed Promise<void> - neither Intake emitter uses
  // the resolved value, only the completion, so this adapter just discards it.
  const awaitAuditEntry = useCallback(
    async (entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> => {
      await addAuditEntry(entry);
    },
    [addAuditEntry]
  );

  useEffect(() => {
    setMatterAuditEmitter(emitAuditEntry);
    setMatterAuditEmitterAsync(addAuditEntry);
    return () => {
      setMatterAuditEmitter(null);
      setMatterAuditEmitterAsync(null);
    };
  }, [addAuditEntry, emitAuditEntry]);

  // EmailViewer's only parent (MainPanel.tsx) isn't wired with an onAuditLog
  // prop, so it reaches the live Activity Log / confidentiality report the
  // same way the matter store does above: App registers its main audit
  // emitter, EmailViewer calls it directly for AI-draft egress + outbound send.
  useEffect(() => {
    setEmailAuditEmitter(emitAuditEntry);
    return () => {
      setEmailAuditEmitter(null);
    };
  }, [emitAuditEntry]);

  useEffect(() => {
    setIntakeNudgeAuditEmitter(emitAuditEntry);
    return () => {
      setIntakeNudgeAuditEmitter(null);
    };
  }, [emitAuditEntry]);

  useEffect(() => {
    // Email-reply filing waits for this promise before any file or fact write.
    setIntakeEmailReplyAuditEmitter(awaitAuditEntry);
    return () => {
      setIntakeEmailReplyAuditEmitter(null);
    };
  }, [awaitAuditEntry]);

  useEffect(() => {
    setIntakeDocumentExtractionAuditEmitter(awaitAuditEntry);
    return () => {
      setIntakeDocumentExtractionAuditEmitter(null);
    };
  }, [awaitAuditEntry]);

  // Handle save audio recording (extracted to useAudioRecording)
  const { handleSaveAudioRecording } = useAudioRecording({
    rootPath,
    workspaceServiceRef,
    setFileTree,
    handleFileOpen,
  });

  // File import handlers: global drag-and-drop + native file picker import
  // (extracted to useFileImport)
  const { handleGlobalFileDrop, handleImportFiles } = useFileImport({
    rootPath,
    workspaceServiceRef,
    setFileTree,
    handleFileOpen,
    undoToast,
    promptForPath: prompt,
  });

  const { isDragging: isFileDragging } = useGlobalFileDrop({
    onDrop: handleGlobalFileDrop,
    enabled: !!rootPath && !showWorkspaceSelector,
  });

  // Workflow execution state and handlers (extracted to useWorkflowRunner).
  const {
    currentExecution,
    activeWorkflowTemplate,
    showInterviewDialog,
    setShowInterviewDialog,
    interviewQuestions,
    workflowProviderError,
    workflowSaveError,
    activeWorkflowFilePath,
    handleStartWorkflow,
    handleInterviewSubmit,
    handleInterviewCancel,
    handleWorkflowSaveAsFile,
    handleWorkflowExportDocx,
    handleWorkflowExportPptx,
  } = useWorkflowRunner({
    rootPath,
    isTestMode: IS_TEST_MODE,
    apiKeys,
    completeRun,
    openTab,
    setFileTree,
    addAuditEntry: emitAuditEntry,
    workspaceServiceRef,
    templatesMetadataReaderRef,
    templatesMarketplaceServiceRef,
  });

  // Handle opening AI Rules file (extracted to useAIRulesFile)
  const { handleOpenAIRules } = useAIRulesFile({
    rootPath,
    workspaceServiceRef,
    handleFileOpen,
    refreshFileTree,
  });

  // Autosave dirty tabs every 2 seconds. See src/app/lifecycle/useAutosave.ts.
  // Routes through writeTabContent so binary formats (.docx/.xlsx/.pptx) decode
  // their data-URL content back to bytes before hitting disk.
  useAutosave(openTabs, writeTabContent, markSaved, workspaceServiceRef);
  // BUG-046: flush dirty tabs on app close / reload (best-effort).
  useFlushOnExit(workspaceServiceRef);
  // BUG-046: flush a tab to disk just before it's closed (Ctrl+W / X / close-all).
  // closeTab() fires this hook synchronously while the tab still exists.
  useEffect(() => {
    // flushTabForClose re-opens the tab + warns if the save fails after the tab
    // was removed (BUG-046 #4), so a failed close-flush can't silently lose work.
    setBeforeTabClose((path) => {
      void flushTabForClose(path);
    });
    return () => {
      setBeforeTabClose(null);
    };
  }, []);
  // QA-34: airtight .docx close for EVERY close path that calls closeTab directly
  // (Ctrl+W, the command palette, right-click Close / Close-others, grouped-tab
  // close). closeTab offers each non-discard close here first; for an open .docx
  // we save it (from its still-mounted editor) before removal and only discard on
  // an explicit user choice, so a locked file can't silently lose in-memory work.
  // (The tab X on either strip already routes through closeDocxTabSafely itself
  // and closes with { discard } — which skips this hook, so there's no double.)
  useEffect(() => {
    setBeforeDocxClose((path) => {
      if (!isDocxRegistered(path)) return false;
      void closeDocxTabSafely(path, {
        closeTab: useEditorStore.getState().closeTab,
        confirmDiscardOnFailure: () =>
          confirm(
            `I couldn't save this document — another program may be blocking the file. ` +
              `Close anyway and lose your latest changes?`,
            {
              title: 'Unsaved changes',
              variant: 'destructive',
              confirmLabel: 'Close and lose changes',
              cancelLabel: 'Keep open',
            }
          ),
      });
      return true;
    });
    return () => {
      setBeforeDocxClose(null);
    };
  }, [confirm]);

  // Command-palette commands. See src/app/commands/useAppCommands.ts.
  const commands = useAppCommands({
    openTabs,
    activeTabPath,
    handleSaveFile,
    closeTab,
    toggleOutline,
    isSplit,
    splitPane,
    closeSplit,
    handleOpenBrowserTab,
    handleCreateDefaultDocument,
    sidebarActiveTab,
    setSidebarCollapsed,
    setShowWorkspaceSelector,
    openAIAssistantTab,
    setShowSettingsModal,
    prompt,
  });

  // Global keyboard shortcuts. See src/app/commands/useKeyboardShortcuts.ts.
  useKeyboardShortcuts({
    sidebarActiveTab,
    openTabs,
    activeTabPath,
    isSplit,
    setShowSettingsModal,
    setShowCommandPalette,
    setShowQuickOpen,
    setSidebarCollapsed,
    setShowShortcutsOverlay,
    setFileTree,
    setDocumentsView,
    setSidebarActiveTab,
    handleSaveFile,
    closeTab,
    toggleOutline,
    splitPane,
    closeSplit,
    openAIAssistantTab,
    handleRestoreFromTrash,
    handleFileOpen,
    handleCreateDefaultDocument,
    workspaceServiceRef,
    undoStackRef,
    deleteHistoryRef,
    renameHistoryRef,
  });

  // Show workspace selector if no workspace is open (unless in test mode).
  // Lantern 3.0: the rebuilt first-run wizard is the live first-run surface.
  // It renders as a full-screen overlay (fixed inset-0 z-50) layered OVER
  // whatever is behind it — most often the WorkspaceSelector, since first run
  // happens before a workspace is chosen — so the existing path-input vs
  // file-picker flow is preserved underneath. We build it once here and render
  // it in both the WorkspaceSelector branch and the main app branch so it shows
  // regardless of which one is active (e.g. ?forceOnboarding with a workspace
  // already open). It supersedes the old WelcomeOnboardingDialog, which only
  // had the email/telemetry consent step; the wizard owns the welcome moment
  // now. `onComplete` (the wizard's markComplete) sets
  // `SK_ONBOARDING_COMPLETE`; on skip we set the same flag so first-run
  // never re-prompts. The Feature Tour then auto-shows as it does today.
  const firstRunOverlay = showFirstRun ? (
    <FirstRunOverlay
      onSaveKey={handleSaveOnboardingApiKey}
      onChooseStart={handleOnboardingChooseStart}
      hasWorkspace={Boolean(rootPath)}
      // QA-9: rendered INSIDE the onboarding shell's own flow (reserves its
      // own height, pushes the step header down) instead of as an
      // independent fixed layer floating above it with no reserved space —
      // that mismatch was the actual bug (the banner painted over "2.
      // Securely connect your data" / "3. Setting up your firm").
      topBanner={
        <>
          <ModelDownloadCard />
          <LocalAiDownloadCard />
        </>
      }
      {...(workspaceServiceRef.current
        ? { workspace: workspaceServiceRef.current }
        : {})}
      onComplete={(opts) => {
        setShowFirstRun(false);
        // The workspace (and, for the sample, its files + active Client Map
        // matter) was already established in the ChooseStart step. The legacy
        // writeSamples branch remains as a fallback for any caller that didn't
        // run ChooseStart (e.g. a workspace was already open).
        if (opts?.writeSamples && rootPath) {
          try {
            const sampleMatter = getOrCreateSampleMatter(rootPath);
            void requestMatterScopeSelection(
              issueMatterScopeSelection(sampleMatter.id)
            ).catch((error: unknown) => {
              console.warn('[App] Sample scope selection failed.', error);
            });
          } catch (err) {
            console.warn(
              '[App] sample-matter post-onboarding setup failed:',
              err instanceof Error ? err.message : String(err)
            );
          }
        }
        // Land on the matter-centric home (Client Map). The sample's Client Map
        // hub is already active when the sample path ran.
        setSidebarActiveTab('matters');
      }}
    />
  ) : null;

  // The WorkspaceSelector is now a full-viewport branded page — no wrapper needed.
  //
  // `|| showFirstRun`: while the first-run overlay is up we deliberately STAY on
  // this branch, even once a workspace has loaded (rootPath set). The overlay is
  // a fixed full-screen layer that renders in BOTH this branch and the main
  // shell; switching branches mid-onboarding would remount OnboardingV2 and reset
  // its internal `scene` state back to the intro — the exact loop QA hit on the
  // "sample practice" path (create workspace → rootPath set → branch flips →
  // wizard remounts at the intro forever). Keeping the branch stable until the
  // wizard finishes (which clears showFirstRun) keeps the wizard mounted and
  // advancing. This matches the documented design: "the wizard layers over the
  // workspace selector as a full-screen overlay."
  // While a "Reopen last workspace" auto-resume attempt is in flight, keep
  // the picker off-screen entirely — otherwise it flashes before the resumed
  // workspace takes over (or, if boot data is read too early, never gets
  // dismissed at all — the bug this hook fixes).
  if (!IS_TEST_MODE && isAutoResumingWorkspace) {
    return (
      <div
        data-testid="workspace-auto-resume-loading"
        className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-white"
      >
        <AppLogo height={48} />
      </div>
    );
  }

  if (
    !IS_TEST_MODE &&
    (showWorkspaceSelector || !rootPath || showFirstRun) &&
    !(IS_DEMO_MODE && !demoOpenFailed)
  ) {
    const canDismiss = Boolean(rootPath);
    return (
      <>
        {/* One-time embedding-model download banner: mounted here as well as
            in the main shell (same both-branches pattern as firstRunOverlay
            below — the branches are exclusive, so only one instance ever
            exists). Mounting runs useModelStatus's probe, so a brand-new
            user's download starts during onboarding rather than after it,
            and returning to the selector mid-download keeps the progress
            visible. The selector is a fixed full-viewport page (z-50), so
            the banner needs its own fixed top-of-screen layer above it.
            QA-9: only while the onboarding wizard is NOT showing — once it
            is, `firstRunOverlay` renders this same banner as its own
            `topBanner` (in normal flow, inside the shell). Keeping this
            fixed copy up at the same time would float back on top of the
            wizard's step header with no reserved space, reintroducing the
            exact overlap this fix removes. */}
        {!showFirstRun && (
          <div className="fixed inset-x-0 top-0 z-[60]">
            <ModelDownloadCard />
            <LocalAiDownloadCard />
          </div>
        )}
        <WorkspaceSelector
          open={true}
          onWorkspaceSelected={handleWorkspaceSelected}
          onDismiss={
            canDismiss ? () => setShowWorkspaceSelector(false) : undefined
          }
          externalError={workspaceOpenError}
          onExternalErrorShown={dismissWorkspaceOpenError}
          promptForPath={prompt}
          autoOpenWorkspacePath={explicitWorkspaceForFirstRun}
        />
        {firstRunOverlay}
        {/* The shared confirm dialog must be mounted in THIS branch too, not
            only in AppDialogs (main-shell branch). Switching workspaces from the
            selector runs handleWorkspaceSelected, whose unsaved-changes guard
            awaits confirm(); without the renderer here that await would hang
            (native window.confirm used to work without a mounted component). */}
        <ConfirmDialog {...confirmDialogProps} />
        {/* QA-32: the prompt dialog must ALSO be mounted here (not only in
            AppDialogs' main-shell branch) — onboarding's "Connect my own
            data" folder picker (below) and WorkspaceSelector's own picker
            calls both run their manual-path-entry fallback via `prompt()`
            while THIS branch is what's on screen (no workspace yet). Without
            a renderer here, that fallback would update state with nothing
            ever shown, leaving the user just as stuck as the picker hang
            itself. */}
        <PromptDialog {...promptDialogProps} />
      </>
    );
  }

  // Shared Settings action handlers (extracted to getSettingsActions — plain
  // factory, no hooks, safe after the WorkspaceSelector early return)
  const { handleSettingsAction, handleSettingsRestartOnboarding } =
    getSettingsActions({
      setApiKeyManagerOpen,
      setApiKeyWizardOpen,
      handleOpenAIRules,
      featureTour,
      setShowWhatsNewModalDirect,
      setTourOpen,
      setShowFirstRun,
    });

  const appSurfaceCapabilities: AppSurfaceCapabilities = {
    navigation: {
      setSurface: setSidebarActiveTab,
      setMattersSurfaceMode,
      pushSnapshot: pushNavigationSnapshot,
    },
    workspace: {
      rootPath,
      activeMatter,
      apiKeys,
      serviceRef: workspaceServiceRef,
      setFileTree,
      refreshFileTree: () => {
        void refreshFileTree();
      },
      requestApiKeySetup: handleRequestApiKeySetup,
      openSelector: () => {
        setShowWorkspaceSelector(true);
      },
    },
    documents: {
      view: documentsView,
      setView: setDocumentsView,
      open: handleFileOpen,
      createFile: (parentPath) => {
        void handleCreateFile(parentPath);
      },
      createFolder: (parentPath) => {
        void handleCreateFolder(parentPath);
      },
      rename: (path) => {
        void handleRename(path);
      },
      renameWithName: handleRenameWithName,
      delete: (path) => {
        void handleDelete(path);
      },
      move: handleMove,
      download: (path, name) => {
        void handleDownload(path, name);
      },
      createDefault: (parentPath) => {
        void handleCreateDefaultDocument(parentPath);
      },
      importFiles: handleImportFiles,
      createDocxAtRoot: handleCreateDocxAtRoot,
      createTextFileAtRoot: handleCreateTextFileAtRoot,
      createFolderAtRoot: handleCreateFolderAtRoot,
      setLetterheadTemplate: handleSetLetterheadTemplate,
      trashItems,
      trashStats,
      trashRetentionPeriod,
      trashCustomRetentionDays,
      restoreFromTrash: handleRestoreFromTrash,
      permanentlyDelete: handlePermanentDelete,
      emptyTrash: handleEmptyTrash,
      changeTrashRetention: handleTrashRetentionChange,
    },
    ask: {
      prefill: askPrefill,
      setPrefill: setAskPrefill,
    },
    workflows: {
      currentExecution,
      activeTemplate: activeWorkflowTemplate,
      showInterviewDialog,
      interviewQuestions,
      providerError: workflowProviderError,
      saveError: workflowSaveError,
      runHistory,
      activeFilePath: activeWorkflowFilePath,
      openTabs,
      submitInterview: handleInterviewSubmit,
      cancelInterview: handleInterviewCancel,
      saveAsFile: handleWorkflowSaveAsFile,
      exportDocx: handleWorkflowExportDocx,
      exportPptx: handleWorkflowExportPptx,
      start: handleStartWorkflow,
    },
    audit: {
      entries: auditEntries,
      integrity: auditIntegrity,
      verifyIntegrity: verifyAuditIntegrity,
      repairSeal: repairAuditSeal,
      addEntry: emitAuditEntry,
    },
    settings: {
      open: openSettings,
      action: handleSettingsAction,
      restartOnboarding: handleSettingsRestartOnboarding,
      loadTemplates: loadAllTemplates,
      extraSections: [],
      pageFocus: settingsPageFocus,
    },
  };

  const schedulingSurface = getAppSurfaceDescriptor('scheduling');
  const settingsSurface = getAppSurfaceDescriptor('settings');
  if (!schedulingSurface || !settingsSurface) {
    throw new Error('Required shell utility surfaces are not registered');
  }

  return (
    <div
      className="h-screen flex flex-col bg-background text-foreground"
      data-testid="app-container"
    >
      <V1ShellFrameFlagGate
        activeSurface={sidebarActiveTab}
        globalStatus={
          <TrustBar
            inline
            onOpenAiSettings={() => {
              openSettingsPage('ai');
            }}
          />
        }
        sidebarCollapsed={sidebarCollapsed}
        onSidebarCollapsedChange={(collapsed) => {
          setSidebarCollapsed(collapsed);
        }}
        onOpenCommandPalette={() => {
          setShowCommandPalette(true);
        }}
        onSurfaceChange={(surface) => {
          if (surface !== sidebarActiveTab) pushNavigationSnapshot();
          if (surface === 'files') setDocumentsView('browser');
          if (surface === 'matters') {
            const matterState = useMatterStore.getState();
            const selection = readSelectionPresentation();
            if (selection.matterId) {
              setMattersSurfaceMode('client-map');
              matterState.setClientMapHubId(selection.matterId);
              matterState.setClientMapHubTab('overview');
            } else {
              setMattersSurfaceMode('all-clients');
              matterState.setClientMapHubId(null);
              matterState.setClientMapHubTab(null);
            }
          }
          setSidebarActiveTab(surface);
        }}
        preTopbar={
          <>
            {workspaceOpenError && (
              <InlineErrorBanner
                message={workspaceOpenError}
                onDismiss={dismissWorkspaceOpenError}
              />
            )}
            {credentialServiceUnavailable && !credentialBannerDismissed && (
              <InlineErrorBanner
                message={t('settings.api-keys.credential-service-unavailable')}
                onDismiss={() => {
                  setCredentialBannerDismissed(true);
                }}
              />
            )}
          </>
        }
        postTopbar={
          <>
            <ModelDownloadCard />
            <LocalAiDownloadCard />
            <RagProgressBanner />
            <ScopeUpdateBanner />
            <TrialBanner
              onActivate={() => {
                openSettings('license');
              }}
            />
          </>
        }
        legacy={
          <>
      {/* Accessibility: skip link so keyboard users can bypass the nav */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-2 focus:rounded focus:bg-background focus:text-foreground focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      {/* QA-33: a failed "open a different recent project" (or a failed
          silent boot-time reopen that fell through to the ALREADY-open
          workspace's UI, not the picker) must never be silent. The current
          workspace is untouched either way, so this is purely informational. */}
      {workspaceOpenError && (
        <InlineErrorBanner
          message={workspaceOpenError}
          onDismiss={dismissWorkspaceOpenError}
        />
      )}
      {/* QA-33: useApiKeys already degrades gracefully when the OS credential
          service is unavailable (falls back to the last known-good key, never
          blocks/crashes) — but that was entirely silent, so a user had no way
          to tell "no AI features right now" apart from "I never set up a key".
          Documents are unaffected either way, hence purely informational. */}
      {credentialServiceUnavailable && !credentialBannerDismissed && (
        <InlineErrorBanner
          message={t('settings.api-keys.credential-service-unavailable')}
          onDismiss={() => {
            setCredentialBannerDismissed(true);
          }}
        />
      )}
      {/* Header bar */}
      <header
        className="flex items-center gap-3 h-14 px-3 border-b bg-background shrink-0"
        data-testid="app-header"
      >
        <AppLogo variant="dark" height={30} className="shrink-0" />
        <TrustBar inline onOpenAiSettings={() => openSettingsPage('ai')} />
        <div className="flex items-center gap-2 shrink-0">
          {/* The gear opens the full-page Settings screen, which nests Privacy
              Center + Activity Log as sections (see AppSurfaceRouter). The
              egress controls stay in the TrustBar; Email + Documents stay
              reachable from the Client Map's per-client quick actions. */}
          <IconButton
            icon={schedulingSurface.icon}
            label={t(schedulingSurface.labelKey)}
            size="sm"
            variant={
              sidebarActiveTab === schedulingSurface.id ? 'secondary' : 'ghost'
            }
            aria-current={
              sidebarActiveTab === schedulingSurface.id ? 'page' : undefined
            }
            data-testid="scheduling-topbar-button"
            onClick={openSchedulingPage}
          />
          <SettingsGearButton
            active={sidebarActiveTab === settingsSurface.id}
            onOpenSettings={() => {
              openSettingsPage();
            }}
          />
          <Button
            data-testid="command-palette-button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 px-0 text-muted-foreground"
            onClick={() => setShowCommandPalette(true)}
            title={t('common.command-palette.open')}
            aria-label={t('common.command-palette.open')}
          >
            <Command className="h-3 w-3" />
          </Button>
        </div>
      </header>

      {/* Memory: model download + live indexing progress banners. Each
          renders only while its work is in flight (one-time embedding-model
          download / workspace indexer running, or briefly after it
          completes); otherwise it returns null and adds zero layout. */}
      <ModelDownloadCard />
      <LocalAiDownloadCard />
      <RagProgressBanner />
      {/* QA-44: shows when a privilege / client scope change has not yet
          applied to search (renders null otherwise). */}
      <ScopeUpdateBanner />

      {/* Trial countdown banner — only renders during the final week of
          the free trial (or once expired) and when no license is active.
          Otherwise null and zero layout. */}
      <TrialBanner onActivate={() => openSettings('license')} />

      {/* Main content area — a real <main> landmark and a focus target so the
          "Skip to main content" link moves keyboard focus here, not just scrolls
          (acc-06). tabIndex={-1} makes the non-interactive region focusable. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 flex overflow-hidden"
      >
        {/* Sidebar with file tree, workflows, research, and settings */}
        <AppShellNav
          activeTab={sidebarActiveTab}
          onTabChange={(tab: string) => {
            if (tab !== sidebarActiveTab) {
              pushNavigationSnapshot();
            }
            // Any click to 'files' in the spine nav lands on the Files browser,
            // even if a document was the last thing open. This is the user
            // clicking the nav (vs a file being opened programmatically), so it
            // always means "show me my files".
            if (tab === 'files') {
              setDocumentsView('browser');
            }
            if (tab === 'matters') {
              const matterState = useMatterStore.getState();
              const selection = readSelectionPresentation();
              if (selection.matterId) {
                setMattersSurfaceMode('client-map');
                matterState.setClientMapHubId(selection.matterId);
                matterState.setClientMapHubTab('overview');
              } else {
                setMattersSurfaceMode('all-clients');
                matterState.setClientMapHubId(null);
                matterState.setClientMapHubTab(null);
              }
            }
            setSidebarActiveTab(tab as typeof sidebarActiveTab);
          }}
          onAllClientsSelect={() => {
            if (
              sidebarActiveTab !== 'matters' ||
              mattersSurfaceMode !== 'all-clients'
            ) {
              pushNavigationSnapshot();
            }
            setMattersSurfaceMode('all-clients');
            setSidebarActiveTab('matters');
          }}
          allClientsSelected={
            sidebarActiveTab === 'matters' &&
            mattersSurfaceMode === 'all-clients'
          }
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        />

        {/* Main editor panel, or a full-page reimagined surface (matters/Ask/Email).
            Wrapped in a top-level error boundary, deliberately OUTSIDE AppShellNav
            above: a render error from ANY surface here (CrmHome, ClientsSurface,
            CrmAskSurface, AssociateHome, SchedulingHome, ...) is caught right here
            instead of propagating past <main> and force-unmounting the whole React
            root — which is what previously took the left nav down with it (see
            fix/sidebar-blank-after-ask). Because AppShellNav is a sibling, not a
            descendant, of this boundary, it is never part of the crashed subtree
            and stays mounted and clickable no matter which surface throws. */}
        <ErrorBoundary label="Workspace">
          <AppSurfaceRuntimeProvider value={appSurfaceCapabilities}>
            <AppSurfaceRouter sidebarActiveTab={sidebarActiveTab} />
          </AppSurfaceRuntimeProvider>
        </ErrorBoundary>
      </main>
          </>
        }
      >
        <ErrorBoundary label="Workspace">
          <AppSurfaceRuntimeProvider value={appSurfaceCapabilities}>
            <AppSurfaceRouter sidebarActiveTab={sidebarActiveTab} />
          </AppSurfaceRuntimeProvider>
        </ErrorBoundary>
      </V1ShellFrameFlagGate>

      {/* Wave 3c: the whole recording UI (position: fixed, floats over every
          surface) — mounted here at the app root, not inside MainPanel, so it
          stays visible while the advisor switches tabs mid-meeting (Documents,
          Email, Ask, etc.), not just while on the Documents/editor surface. */}
      <RecordPill />
      <div
        style={{
          position: 'fixed',
          right: 'calc(var(--kp-gutter, 24px) + 8px)',
          bottom: '72px',
          width: 'min(520px, calc(100vw - 32px))',
          zIndex: 45,
          pointerEvents: 'auto',
        }}
      >
        <AutoJoinMeetingsPanel />
      </div>
      <MeetingAutoJoinScheduler />

      {/* Status bar. showFileContext=true only on the Documents/editor surface
          (files tab) so the breadcrumb never shows stale editor context when
          the user is on Search, Email, Workflows, etc. (A8.2). */}
      <StatusBar
        onOpenSettings={() => openSettings('license')}
        showFileContext={sidebarActiveTab === 'files'}
      />

      <AppDialogs
        addAuditEntry={emitAuditEntry}
        matterManagerOpen={matterManagerOpen}
        setMatterManagerOpen={setMatterManagerOpen}
        clientSettingsMatterId={clientSettingsMatterId}
        newClientOpen={newClientOpen}
        setNewClientOpen={setNewClientOpen}
        newGroupOpen={newGroupOpen}
        setNewGroupOpen={setNewGroupOpen}
        showInterviewDialog={showInterviewDialog}
        setShowInterviewDialog={setShowInterviewDialog}
        interviewQuestions={interviewQuestions}
        handleInterviewSubmit={handleInterviewSubmit}
        handleInterviewCancel={handleInterviewCancel}
        showCommandPalette={showCommandPalette}
        setShowCommandPalette={setShowCommandPalette}
        commands={commands}
        showSettingsModal={showSettingsModal}
        setShowSettingsModal={setShowSettingsModal}
        auditEntries={auditEntries}
        settingsInitialCategory={settingsInitialCategory}
        handleSettingsAction={handleSettingsAction}
        handleSettingsRestartOnboarding={handleSettingsRestartOnboarding}
        hasWorkspaceOpen={Boolean(rootPath)}
        accountWindowOpen={accountWindowOpen}
        setAccountWindowOpen={setAccountWindowOpen}
        accountWindowInitialTab={accountWindowInitialTab}
        onAccountWindowClosed={() => setAccountWindowInitialTab(undefined)}
        firstRunOverlay={firstRunOverlay}
        tourOpen={tourOpen}
        showFirstRun={showFirstRun}
        setTourOpen={setTourOpen}
        featureTour={featureTour}
        apiKeyWizardOpen={apiKeyWizardOpen}
        setApiKeyWizardOpen={setApiKeyWizardOpen}
        handleSaveOnboardingApiKey={handleSaveOnboardingApiKey}
        apiKeyManagerOpen={apiKeyManagerOpen}
        setApiKeyManagerOpen={setApiKeyManagerOpen}
        apiKeyKeychain={keychainService}
        onApiKeyRemoved={handleRemoveApiKey}
        showShortcutsOverlay={showShortcutsOverlay}
        setShowShortcutsOverlay={setShowShortcutsOverlay}
        showQuickOpen={showQuickOpen}
        setShowQuickOpen={setShowQuickOpen}
        fileTree={fileTree}
        handleFileOpen={handleFileOpen}
        showAudioRecorder={showAudioRecorder}
        setShowAudioRecorder={setShowAudioRecorder}
        handleSaveAudioRecording={handleSaveAudioRecording}
        confirmDialogProps={confirmDialogProps}
        promptDialogProps={promptDialogProps}
        undoToast={undoToast}
        isFileDragging={isFileDragging}
        showWhatsNewModalDirect={showWhatsNewModalDirect}
        setShowWhatsNewModalDirect={setShowWhatsNewModalDirect}
      />

      {/* Connector citation viewers (Wealthbox, OneDrive, DocuSign, Calendly,
          Box, ShareFile, Jotform, Zocks, Addepar) — not rendered at all until
          the first citation click (see connectorPanelsNeeded above), so the
          chunk is fetched on demand rather than on every cold start. Once
          mounted each one self-gates on its own window event and renders
          nothing until a matching citation is clicked, so a null Suspense
          fallback is safe here. LazyBoundary contains a failed chunk fetch
          behind a Retry card instead of letting it unmount the whole app. */}
      {connectorPanelsNeeded && (
        <LazyBoundary
          loader={loadConnectorSourcePanels}
          fallback={null}
          label="Connector panel"
        >
          {(ConnectorSourcePanels) => <ConnectorSourcePanels />}
        </LazyBoundary>
      )}
    </div>
  );
}

export default App;
