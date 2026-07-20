/**
 * getSettingsActions — owns handleSettingsAction and handleSettingsRestartOnboarding.
 *
 * Extracted from App.tsx (Wave 5b decomposition). The function bodies are
 * copied VERBATIM from App.tsx; only the source of referenced values changed
 * (they now come from the options object instead of App's local scope).
 * Named `get*` (not `use*`) because it contains NO React hooks — plain
 * factory function, safe to call after an early return.
 */
import { manualUpdateCheck } from '@/platform/updater/UpdateManager';
import { openExternal } from '@/platform/utils/openExternal';
import { BRAND } from '@/config/brand';
import type { useFeatureTour } from '@/platform/hooks/useFeatureTour';

export interface GetSettingsActionsOptions {
  setApiKeyManagerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setApiKeyWizardOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleOpenAIRules: () => Promise<void>;
  featureTour: ReturnType<typeof useFeatureTour>;
  setShowWhatsNewModalDirect: React.Dispatch<React.SetStateAction<boolean>>;
  setTourOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowFirstRun: React.Dispatch<React.SetStateAction<boolean>>;
}

export function getSettingsActions({
  setApiKeyManagerOpen,
  setApiKeyWizardOpen,
  handleOpenAIRules,
  featureTour,
  setShowWhatsNewModalDirect,
  setTourOpen,
  setShowFirstRun,
}: GetSettingsActionsOptions) {
  // Shared Settings action handler — used by BOTH the quick Settings modal and
  // the full-page Settings nav tab so every action link (Manage AI keys, Check
  // for updates, Open website, …) behaves identically in either surface.
  const handleSettingsAction = (actionId: string) => {
    if (actionId === 'open-ai-keys') {
      // "Manage AI Account Keys" now opens the manager (list + remove + add),
      // not the add-only wizard. The manager's "Add a provider key" button
      // opens the wizard from there.
      setApiKeyManagerOpen(true);
    } else if (actionId === 'open-api-key-tutorial') {
      setApiKeyWizardOpen(true);
    } else if (actionId === 'open-ai-rules') {
      void handleOpenAIRules();
    } else if (actionId === 'updater-check-now') {
      void manualUpdateCheck();
    } else if (actionId === 'open-whats-new') {
      setShowWhatsNewModalDirect(true);
    } else if (actionId === 'open-website') {
      void openExternal(BRAND.urls.site);
    } else if (actionId === 'open-github') {
      void openExternal(BRAND.urls.repository);
    } else if (actionId === 'reset-feature-tour') {
      featureTour.restart();
      setTimeout(() => { setTourOpen(true); }, 300);
    }
  };

  const handleSettingsRestartOnboarding = () => {
    setShowFirstRun(true);
  };

  return { handleSettingsAction, handleSettingsRestartOnboarding };
}
