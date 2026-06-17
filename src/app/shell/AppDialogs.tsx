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

import { useTranslation } from 'react-i18next';

import { McpApprovalGate } from '@/features/settings/McpApprovalGate';
import { MatterManagerDialog } from '@/features/matters/MatterManagerDialog';
import { InterviewForm } from '@/features/workflows/InterviewForm';
import { CommandPalette, type PaletteCommand } from '@/app/shell/common/CommandPalette';
import { SettingsModal } from '@/features/settings/SettingsModal';
import { AccountWindow } from '@/features/account/AccountWindow';
import { FeatureTour } from '@/features/onboarding/FeatureTour';
import { ApiKeyWizard } from '@/features/onboarding/ApiKeyWizard';
import { ShortcutsOverlay } from '@/app/shell/ShortcutsOverlay';
import { QuickOpen } from '@/app/shell/QuickOpen';
import { AudioRecorderModal } from '@/features/dictation/audio/AudioRecorderModal';
import { ConfirmDialog, type ConfirmDialogProps } from '@/ui/ConfirmDialog';
import { PromptDialog, type PromptDialogProps } from '@/app/shell/common/PromptDialog';
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

  // Shortcuts overlay
  showShortcutsOverlay: boolean;
  setShowShortcutsOverlay: (open: boolean) => void;

  // Quick open
  showQuickOpen: boolean;
  setShowQuickOpen: (open: boolean) => void;
  fileTree: FileNode[];
  handleFileOpen: (path: string, name: string) => void | Promise<void>;

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
  firstRunOverlay,
  tourOpen,
  showFirstRun,
  setTourOpen,
  featureTour,
  apiKeyWizardOpen,
  setApiKeyWizardOpen,
  handleSaveOnboardingApiKey: handleSaveKey,
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

  return (
    <>
      {/* MCP write-approval gate. Polls for sidecar write requests and renders
          the approval modal. In Privileged Matter Mode it auto-denies every MCP
          write and records each block in the audit log. */}
      <McpApprovalGate
        onAuditEvent={(event: AuditEvent) => addAuditEntry(auditEventToEntry(event))}
      />

      {/* Bug 1: MatterManagerDialog — opened by 'keepance:open-matter-manager'
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

      {/* Account / firm window — opened from the rail's account identity. */}
      <AccountWindow
        open={accountWindowOpen}
        onOpenChange={setAccountWindowOpen}
        auditEntries={auditEntries}
      />

      {/* Keepance 3.0: rebuilt first-run wizard — the live first-run surface.
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

      {/* Shell-aware API key wizard — opened from reimagined shell CTAs */}
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
