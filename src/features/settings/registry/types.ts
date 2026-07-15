import type { ReactNode } from 'react';
import type { SectionCategory, SettingDefinition } from '@/platform/settings/schema';
import type { AuditEntry } from '@/platform/types/audit';
import type { WorkflowTemplate } from '@/platform/types/workflow';

/**
 * Closed, augmentable vocabulary for settings rail sections. Feature modules
 * add their own id with module augmentation; unregistered ids stay type errors.
 */
export interface SettingsSectionMap {
  // Feature modules register their ids with `declare module` beside the
  // descriptor. Keeping this empty prevents an accidental central id list.
}

export type SettingsSectionId = Extract<keyof SettingsSectionMap, string>;

export interface SettingsSectionRenderProps {
  getSetting: (key: string) => unknown;
  setSetting: (key: string, value: unknown) => void;
  onAction: (actionId: string) => void;
  filteredKeys: Set<string>;
  searchQuery: string;
  searchActive: boolean;
  auditEntries?: AuditEntry[] | undefined;
  templates?: WorkflowTemplate[] | undefined;
  onRestartOnboarding?: (() => void) | undefined;
  onNavigate: (section: SectionCategory) => void;
  hasWorkspaceOpen: boolean;
}

export interface SettingsGroupDescriptor {
  id: string;
  section: SettingsSectionId;
  keywords: readonly string[];
}

/** One feature-owned settings section and its platform definitions. */
export interface SettingsModuleDescriptor {
  id: SettingsSectionId;
  /** Stable rail order. Existing entries must not be reordered in a feature wave. */
  order: number;
  labelKey: string;
  legacyLabel: string;
  definitions?: readonly SettingDefinition[] | (() => readonly SettingDefinition[]);
  groups?: readonly SettingsGroupDescriptor[];
  searchTerms?: readonly string[];
  render: (props: SettingsSectionRenderProps) => ReactNode;
}
