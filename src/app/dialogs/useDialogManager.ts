/**
 * useDialogManager — owns all pure UI-toggle dialog/modal open state for the
 * app shell. These are the "is this dialog visible?" booleans (and a few
 * related pieces like the settings deep-link category) that have no effects,
 * no store dependencies, and no async logic attached to them in App.tsx.
 *
 * Extracted from App.tsx (Phase 3 decomposition). Every variable name and
 * every initial value is byte-for-byte identical to the original declarations
 * so that wiring-in via destructuring is a pure refactor with no behavior
 * change.
 */
import { useState, useCallback } from 'react';
import type { SettingCategory } from '@/settings/schema';

/** All dialog/modal toggle state surfaced by useDialogManager. */
export interface DialogManager {
  showCommandPalette: boolean;
  setShowCommandPalette: React.Dispatch<React.SetStateAction<boolean>>;

  showShortcutsOverlay: boolean;
  setShowShortcutsOverlay: React.Dispatch<React.SetStateAction<boolean>>;

  showQuickOpen: boolean;
  setShowQuickOpen: React.Dispatch<React.SetStateAction<boolean>>;

  showAudioRecorder: boolean;
  setShowAudioRecorder: React.Dispatch<React.SetStateAction<boolean>>;

  showSettingsModal: boolean;
  setShowSettingsModal: React.Dispatch<React.SetStateAction<boolean>>;

  settingsInitialCategory: SettingCategory | undefined;
  setSettingsInitialCategory: React.Dispatch<React.SetStateAction<SettingCategory | undefined>>;

  /** Open Settings, optionally deep-linked to a category. */
  openSettings: (category?: SettingCategory) => void;

  accountWindowOpen: boolean;
  setAccountWindowOpen: React.Dispatch<React.SetStateAction<boolean>>;

  matterManagerOpen: boolean;
  setMatterManagerOpen: React.Dispatch<React.SetStateAction<boolean>>;

  showWhatsNewModalDirect: boolean;
  setShowWhatsNewModalDirect: React.Dispatch<React.SetStateAction<boolean>>;

  apiKeyWizardOpen: boolean;
  setApiKeyWizardOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useDialogManager(): DialogManager {
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showShortcutsOverlay, setShowShortcutsOverlay] = useState(false);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [showAudioRecorder, setShowAudioRecorder] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  // Which Settings category to show on next open. Reset to undefined so a
  // later open without a category falls back to the modal's own default.
  const [settingsInitialCategory, setSettingsInitialCategory] =
    useState<SettingCategory | undefined>(undefined);
  // Helper: open Settings, optionally deep-linked to a category.
  const openSettings = useCallback((category?: SettingCategory) => {
    setSettingsInitialCategory(category);
    setShowSettingsModal(true);
  }, []);
  const [accountWindowOpen, setAccountWindowOpen] = useState(false);
  // Bug 1: MatterManagerDialog open state — driven by the
  // 'keepance:open-matter-manager' custom event from ReimaginedMattersHome.
  const [matterManagerOpen, setMatterManagerOpen] = useState(false);
  // Direct trigger for the WhatsNew changelog modal from outside the
  // WhatsNewLayer (e.g. the Settings → About → "What's new" action).
  const [showWhatsNewModalDirect, setShowWhatsNewModalDirect] = useState(false);
  // Shell-aware API key wizard — opened from reimagined shell CTAs.
  const [apiKeyWizardOpen, setApiKeyWizardOpen] = useState<boolean>(false);

  return {
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
    setSettingsInitialCategory,
    openSettings,
    accountWindowOpen,
    setAccountWindowOpen,
    matterManagerOpen,
    setMatterManagerOpen,
    showWhatsNewModalDirect,
    setShowWhatsNewModalDirect,
    apiKeyWizardOpen,
    setApiKeyWizardOpen,
  };
}
