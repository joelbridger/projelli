/**
 * SettingsModal — thin Dialog wrapper around <SettingsContent>.
 *
 * The whole Settings UI (the 5-section nav, the search bar, the accordion
 * sub-sections, the content area, and the Export/Import/Reset footer) lives in
 * <SettingsContent> so the exact same surface can render full-page as the
 * "Settings" nav tab. This wrapper only adds the dialog chrome.
 *
 * Deep-link aliases: any legacy category id (general, ai, integrations, etc.)
 * resolves to the correct section via CATEGORY_ALIAS_MAP in schema.ts.
 *
 * Opened via: gear icon in the header, Ctrl+, shortcut, or command palette.
 *
 * The modal content is remounted (via the `openKey`) every time it transitions
 * from closed to open, so `initialCategory` is re-applied on each open even when
 * the deep-link category is unchanged — preserving the original behavior.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsContent } from '@/components/settings/SettingsContent';
import type { SettingCategory } from '@/settings/schema';
import type { AuditEntry } from '@/types/audit';
import type { WorkflowTemplate } from '@/types/workflow';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Callback when an action link is clicked (e.g., "Manage API Keys"). */
  onAction?: (actionId: string) => void;
  /** Audit entries for the Account section (Usage sub-section). */
  auditEntries?: AuditEntry[];
  /** Workflow templates for the per-template model table (Extensions). */
  templates?: WorkflowTemplate[];
  /**
   * Which category (canonical section id OR legacy alias) to open the modal on.
   * Re-applied every time the modal transitions from closed to open. Legacy ids
   * (general, ai, integrations, memory, etc.) resolve via CATEGORY_ALIAS_MAP.
   */
  initialCategory?: SettingCategory;
  /** Called when the user clicks "Restart guided setup" in the setup checklist. */
  onRestartOnboarding?: () => void;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function SettingsModal({
  open,
  onOpenChange,
  onAction,
  auditEntries,
  templates,
  initialCategory,
  onRestartOnboarding,
}: SettingsModalProps) {
  const { t } = useTranslation();

  // Bump a key on each closed→open transition so <SettingsContent> remounts and
  // re-applies `initialCategory` even when the deep-link category is unchanged.
  // Uses the React-sanctioned "adjust state during render when a prop changes"
  // pattern (not an effect) so the remount key is ready in the same render the
  // dialog opens.
  const [openKey, setOpenKey] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setOpenKey((k) => k + 1);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="settings-modal"
        className="max-w-3xl w-[90vw] h-[80vh] max-h-[700px] p-0 flex flex-col overflow-hidden [&>button]:hidden"
      >
        <DialogTitle className="sr-only">{t('settings.modal.title')}</DialogTitle>
        <DialogDescription className="sr-only">
          {t('settings.modal.description')}
        </DialogDescription>

        <SettingsContent
          key={openKey}
          variant="modal"
          onClose={() => { onOpenChange(false); }}
          onRequestClose={() => { onOpenChange(false); }}
          {...(onAction ? { onAction } : {})}
          auditEntries={auditEntries}
          templates={templates}
          {...(initialCategory ? { initialCategory } : {})}
          {...(onRestartOnboarding ? { onRestartOnboarding } : {})}
        />
      </DialogContent>
    </Dialog>
  );
}

export default SettingsModal;
