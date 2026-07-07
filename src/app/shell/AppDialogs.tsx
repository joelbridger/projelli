/**
 * AppDialogs — presentational shell component that hosts every overlay,
 * modal, and floating layer that lives outside the main panel tree.
 *
 * Extracted from App.tsx (Phase 3 shell refactor) to keep App.tsx focused
 * on layout + state wiring while this file owns the portal/overlay cluster.
 *
 * All handlers and state values are passed down as props — no hooks here
 * beyond `useTranslation` (for the interview dialog copy) and the module-
 * local WhatsNewLayer wrapper.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LazyBoundary } from '@/ui/LazyBoundary';

import { McpApprovalGate } from '@/features/settings/McpApprovalGate';
import { AiWriteApprovalModal } from '@/features/ask/AiWriteApprovalModal';
import { AiBatchReviewPanel } from '@/features/ask/AiBatchReviewPanel';
import { MatterManagerDialog } from '@/features/matters/MatterManagerDialog';
import { InterviewForm } from '@/features/workflows/InterviewForm';
import { CommandPalette, type PaletteCommand } from '@/app/shell/common/CommandPalette';
import { SettingsModal } from '@/features/settings/SettingsModal';
import { FeatureTour } from '@/features/onboarding/FeatureTour';
import { ApiKeyWizard } from '@/features/onboarding/ApiKeyWizard';
import { ApiKeyManager, type ApiKeyManagerKeychain } from '@/features/settings/ApiKeyManager';
import { ShortcutsOverlay } from '@/app/shell/ShortcutsOverlay';
import { QuickOpen } from '@/app/shell/QuickOpen';
import { AudioRecorderModal } from '@/features/dictation/audio/AudioRecorderModal';
import { ConfirmDialog, type ConfirmDialogProps } from '@/ui/ConfirmDialog';
import { PromptDialog, type PromptDialogProps } from '@/ui/PromptDialog';
import { UndoToastRenderer, type UndoToastController } from '@/app/shell/common/UndoToast';
import { GlobalDropOverlay } from '@/app/shell/common/GlobalDropOverlay';
import { WhatsNewToast, WhatsNewModal, useWhatsNew } from '@/app/shell/WhatsNew';
import { UpdateManager } from '@/platform/updater/UpdateManager';
import { type WizardProvider } from '@/features/onboarding/ApiKeyWizard';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';

import type { AuditEntry, AuditEvent } from '@/platform/types/audit';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import { loadAllTemplates } from '@/features/workflows/engine/userTemplates';
import type { InterviewQuestion } from '@/platform/types/workflow';
import type { FileNode } from '@/platform/types/workspace';
import type { SettingCategory } from '@/platform/settings/schema';

// AccountWindow pulls in every connector "Connect" setup panel (Wealthbox,
// OneDrive, Box, DocuSign, ShareFile, Jotform, Zocks, Addepar, Calendly,
// Salesforce, Redtail, plus mail + firm admin) — lazy so none of that rides
// into the startup bundle until the user actually opens Account settings.
const loadAccountWindow = () => import('@/features/account/AccountWindow');

export interface AppDialogsProps {
  // MCP gate
  addAuditEntry: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;

  // Matter manager
  matterManagerOpen: boolean;
  setMatterManagerOpen: (open: boolean) => void;

  // Interview dialog
  showInterviewDialog: boolean;
  setShowInterviewDialog: (open: boolean) => void;
  interviewQuestions: InterviewQuestion[] | null;
  handleInterviewSubmit: (answers: Record<string, string>) => void;
  handleInterviewCancel: () => void;

  // Command palette
  showCommandPalette: boolean;
  setShowCommandPalette: (open: boolean) => void;
  commands: PaletteCommand[];

  // Settings modal
  showSettingsModal: boolean;
  setShowSettingsModal: (open: boolean) => void;
  auditEntries: AuditEntry[];
  settingsInitialCategory: SettingCategory | undefined;
  handleSettingsAction: (actionId: string) => void;
  handleSettingsRestartOnboarding: () => void;

  // Account window
  accountWindowOpen: boolean;
  setAccountWindowOpen: (open: boolean) => void;
  /** Tab to pre-select when the window opens (e.g. 'connections'). */
  accountWindowInitialTab?: string | undefined;
  /** Called when the account window closes, so the caller can clear initialTab. */
  onAccountWindowClosed?: () => void;

  // First-run overlay (pre-built JSX from App)
  firstRunOverlay: React.ReactNode;

  // Feature tour
  tourOpen: boolean;
  showFirstRun: boolean;
  setTourOpen: (open: boolean) => void;
  featureTour: {
    complete: () => void;
    skipForNow: () => void;
  };

  // API key wizard
  apiKeyWizardOpen: boolean;
  setApiKeyWizardOpen: (open: boolean) => void;
  handleSaveOnboardingApiKey: (
    provider: 'anthropic' | 'openai' | 'google',
    key: string
  ) => void | Promise<void>;

  // "Manage AI Account Keys" — list + remove saved keys
  apiKeyManagerOpen: boolean;
  setApiKeyManagerOpen: (open: boolean) => void;
  /** Shared KeychainService instance (same one the wizard saves through). */
  apiKeyKeychain: ApiKeyManagerKeychain;
  /** Called after a key is removed (with the provider), so AI state can refresh. */
  onApiKeyRemoved?: (provider: 'anthropic' | 'openai' | 'google') => void;

  // Shortcuts overlay
  showShortcutsOverlay: boolean;
  setShowShortcutsOverlay: (open: boolean) => void;

  // Quick open
  showQuickOpen: boolean;
  setShowQuickOpen: (open: boolean) => void;
  fileTree: FileNode[];
  handleFileOpen: (path: string, name: string) => unknown;

  // Audio recorder
  showAudioRecorder: boolean;
  setShowAudioRecorder: (open: boolean) => void;
  handleSaveAudioRecording: (audioBlob: Blob, filename: string) => Promise<void>;

  // Confirm / prompt dialogs
  confirmDialogProps: ConfirmDialogProps;
  promptDialogProps: PromptDialogProps;

  // Undo toast
  undoToast: UndoToastController;

  // Global drop overlay
  isFileDragging: boolean;

  // What's new (manual trigger from Settings → About)
  showWhatsNewModalDirect: boolean;
  setShowWhatsNewModalDirect: (open: boolean) => void;
}

export function AppDialogs({
  addAuditEntry,
  matterManagerOpen,
  setMatterManagerOpen,
  showInterviewDialog,
  setShowInterviewDialog,
  interviewQuestions,
  handleInterviewSubmit,
  handleInterviewCancel,
  showCommandPalette,
  setShowCommandPalette,
  commands,
  showSettingsModal,
  setShowSettingsModal,
  auditEntries,
  settingsInitialCategory,
  handleSettingsAction,
  handleSettingsRestartOnboarding,
  accountWindowOpen,
  setAccountWindowOpen,
  accountWindowInitialTab,
  onAccountWindowClosed,
  firstRunOverlay,
  tourOpen,
  showFirstRun,
  setTourOpen,
  featureTour,
  apiKeyWizardOpen,
  setApiKeyWizardOpen,
  handleSaveOnboardingApiKey: handleSaveKey,
  apiKeyManagerOpen,
  setApiKeyManagerOpen,
  apiKeyKeychain,
  onApiKeyRemoved,
  showShortcutsOverlay,
  setShowShortcutsOverlay,
  showQuickOpen,
  setShowQuickOpen,
  fileTree,
  handleFileOpen,
  showAudioRecorder,
  setShowAudioRecorder,
  handleSaveAudioRecording,
  confirmDialogProps,
  promptDialogProps,
  undoToast,
  isFileDragging,
  showWhatsNewModalDirect,
  setShowWhatsNewModalDirect,
}: AppDialogsProps) {
  const { t } = useTranslation();

  // AccountWindow is mounted unconditionally (Radix Dialog controls
  // visibility via `open`, not mount) so its state survives a close/reopen —
  // but `Suspense` starts the dynamic import() the moment React renders the
  // lazy component AT ALL, regardless of `open`. Gate actual rendering behind
  // "has this ever been opened" so the connector-setup-panel chunk is only
  // fetched the first time the user opens Account settings, not on every
  // cold start. This is the standard "adjust state during render" pattern
  // (same one AccountWindow itself already uses for its active-tab reset) —
  // not a ref, since reading/writing a ref during render is unsafe.
  const [accountWindowEverOpened, setAccountWindowEverOpened] = useState(accountWindowOpen);
  if (accountWindowOpen && !accountWindowEverOpened) {
    setAccountWindowEverOpened(true);
  }

  return (
    <>
      {/* MCP write-approval gate. Polls for sidecar write requests and renders
          the approval modal. In Privileged Matter Mode it auto-denies every MCP
          write and records each block in the audit log. */}
      <McpApprovalGate
        onAuditEvent={(event: AuditEvent) => addAuditEntry(auditEventToEntry(event))}
      />

      {/* BUG-060: AI file-change approval. Self-gates on the approval store's
          pending request (set by the chat tool executor); shows nothing when
          idle. Lets the user Approve/Skip an AI write/move/delete with a diff. */}
      <AiWriteApprovalModal />

      {/* BUG-060 (batch mode): end-of-turn review of every file change the AI
          applied this turn. Self-gates on the batch store; shows nothing unless
          batch mode collected changes and the turn opened the review. */}
      <AiBatchReviewPanel />

      {/* Bug 1: MatterManagerDialog — opened by 'lantern:open-matter-manager'
          events from the "New matter" buttons in MattersHome. */}
      <MatterManagerDialog open={matterManagerOpen} onOpenChange={setMatterManagerOpen} />

      {/* Interview Dialog */}
      <Dialog open={showInterviewDialog} onOpenChange={setShowInterviewDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('app.interview.title')}</DialogTitle>
            <DialogDescription>
              {t('app.interview.description')}
            </DialogDescription>
          </DialogHeader>
          {interviewQuestions && (
            <InterviewForm
              questions={interviewQuestions}
              onSubmit={handleInterviewSubmit}
              onCancel={handleInterviewCancel}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Command Palette */}
      <CommandPalette
        open={showCommandPalette}
        onOpenChange={setShowCommandPalette}
        commands={commands}
      />

      {/* Settings Modal — the quick, deep-linkable surface (gear / Ctrl+, /
          command palette). The same content also lives full-page as the
          Settings nav tab; both share handleSettingsAction. */}
      <SettingsModal
        open={showSettingsModal}
        onOpenChange={setShowSettingsModal}
        auditEntries={auditEntries}
        templates={loadAllTemplates()}
        {...(settingsInitialCategory ? { initialCategory: settingsInitialCategory } : {})}
        onAction={handleSettingsAction}
        onRestartOnboarding={handleSettingsRestartOnboarding}
      />

      {/* Account / firm window — opened from the rail's account identity, or from
          email connect entry points (pre-selects the Connections tab).
          Not rendered at all until first opened (see accountWindowEverOpened
          above) — rendering the lazy component, even closed, would start its
          import() immediately. Suspense fallback is `null`, not a spinner:
          once opened it stays mounted (Radix Dialog controls visibility via
          `open`, not mount) so a visible fallback would flash on later opens
          while re-rendering, not just the first cold fetch. LazyBoundary
          contains a failed chunk fetch behind a Retry card instead of
          letting it unmount the whole app (bench pass 2). */}
      {accountWindowEverOpened && (
        <LazyBoundary loader={loadAccountWindow} fallback={null} label="Account settings">
          {(AccountWindow) => (
            <AccountWindow
              open={accountWindowOpen}
              onOpenChange={(open) => {
                setAccountWindowOpen(open);
                if (!open) onAccountWindowClosed?.();
              }}
              auditEntries={auditEntries}
              initialTab={accountWindowInitialTab}
            />
          )}
        </LazyBoundary>
      )}

      {/* Advisor Prep Hero 3.0: rebuilt first-run wizard — the live first-run surface.
          Built above as `firstRunOverlay` so it also renders over the
          WorkspaceSelector branch (where first run usually happens). */}
      {firstRunOverlay}

      {/* v1.6: 5-step Feature Tour (auto-shows on first launch) */}
      <FeatureTour
        open={tourOpen && !showFirstRun}
        onClose={() => setTourOpen(false)}
        onComplete={() => {
          featureTour.complete();
          setTourOpen(false);
        }}
        onSkip={() => {
          featureTour.skipForNow();
          setTourOpen(false);
        }}
      />

      {/* "Manage AI Account Keys" — lists the saved provider keys with a
          masked prefix, a status, and Remove; "Add a provider key" hands off
          to the wizard below. Opened from AI & Privacy settings. */}
      <ApiKeyManager
        open={apiKeyManagerOpen}
        onOpenChange={setApiKeyManagerOpen}
        keychainService={apiKeyKeychain}
        onAddKey={() => {
          setApiKeyManagerOpen(false);
          setApiKeyWizardOpen(true);
        }}
        {...(onApiKeyRemoved ? { onKeyRemoved: onApiKeyRemoved } : {})}
      />

      {/* Shell-aware API key wizard — opened from reimagined shell CTAs and
          from the manager's "Add a provider key" button. */}
      <ApiKeyWizard
        open={apiKeyWizardOpen}
        onOpenChange={setApiKeyWizardOpen}
        onSaveKey={(provider: WizardProvider, key) => {
          void handleSaveKey(
            provider as 'anthropic' | 'openai' | 'google',
            key
          );
        }}
      />

      {/* Keyboard Shortcuts Overlay (UX-10) */}
      <ShortcutsOverlay
        open={showShortcutsOverlay}
        onOpenChange={setShowShortcutsOverlay}
      />

      {/* UX-27: Quick-open fuzzy file switcher (Ctrl+P) */}
      <QuickOpen
        open={showQuickOpen}
        onOpenChange={setShowQuickOpen}
        fileTree={fileTree}
        onFileOpen={handleFileOpen}
      />

      {/* Audio Recorder Modal */}
      <AudioRecorderModal
        isOpen={showAudioRecorder}
        onClose={() => setShowAudioRecorder(false)}
        onSave={handleSaveAudioRecording}
      />

      {/* Confirmation Dialog */}
      <ConfirmDialog {...confirmDialogProps} />

      {/* Prompt Dialog */}
      <PromptDialog {...promptDialogProps} />

      {/* UX-16: Undo toast for destructive actions */}
      <UndoToastRenderer controller={undoToast} />

      {/* UX-19: Global drop overlay. Visible while files are dragged over the window. */}
      <GlobalDropOverlay visible={isFileDragging} />

      {/* UX-20: What's new toast + changelog modal */}
      <WhatsNewLayer />

      {/* Manually-triggered version of the changelog modal, opened from
          Settings → About so users can revisit release notes anytime. */}
      <WhatsNewModal
        open={showWhatsNewModalDirect}
        onOpenChange={setShowWhatsNewModalDirect}
      />

      {/* Auto-updater banner + scheduled background checks. No-op outside
          Tauri so the browser / test mode never sees it. */}
      <UpdateManager />
    </>
  );
}

/**
 * UX-20: local wrapper so we can call the hook inside a component tree that
 * doesn't already subscribe to the app's other state. Mounted once near the
 * UndoToastRenderer.
 */
function WhatsNewLayer() {
  const { toastOpen, modalOpen, version, openModal, dismissToast, closeModal } = useWhatsNew();
  return (
    <>
      <WhatsNewToast
        open={toastOpen}
        version={version}
        onOpenModal={openModal}
        onDismiss={dismissToast}
      />
      <WhatsNewModal open={modalOpen} onOpenChange={closeModal} />
    </>
  );
}
