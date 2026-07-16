import type { ReactNode } from 'react';
import type { SettingCategory } from '@/platform/settings/schema';
import type { AuditEntry } from '@/platform/types/audit';

/**
 * The narrow shell capability contract consumed by the feature. Keeping it
 * here prevents the Settings feature from importing the app layer.
 */
export interface SettingsV1Runtime {
  legacy: {
    settings: () => ReactNode;
  };
  settings: {
    action: (actionId: string) => void;
    restartOnboarding: () => void;
    pageFocus?: { category?: SettingCategory; key: number } | undefined;
  };
  audit: {
    entries: AuditEntry[];
  };
  workspace: {
    rootPath: string | null | undefined;
  };
}
