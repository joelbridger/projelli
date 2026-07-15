import type { ReactNode } from 'react';
import type {
  SectionCategory,
  SettingDefinition,
} from '@/platform/settings/schema';
import type { AuditEntry } from '@/platform/types/audit';
import type { WorkflowTemplate } from '@/platform/types/workflow';
import type { SettingsSectionId } from '@/platform/types/settings';
import type { FlagId } from '@/platform/flags/registry';

/**
 * Closed, augmentable vocabulary for settings rail sections. The platform owns
 * the base vocabulary; feature modules may augment that platform map beside a
 * descriptor. Unregistered ids stay type errors.
 */
export type { SettingsSectionId } from '@/platform/types/settings';

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

/** One entry in the Settings rail. Sections without a visible panel stay hidden. */
export interface SettingsSectionDescriptor {
  id: SettingsSectionId;
  /** Stable rail order. Existing entries must not be reordered in a feature wave. */
  order: number;
  labelKey: string;
  legacyLabel: string;
  definitions?:
    | readonly SettingDefinition[]
    | (() => readonly SettingDefinition[]);
  groups?: readonly SettingsGroupDescriptor[];
  searchTerms?: readonly string[];
}

/**
 * A feature-owned panel mounted inside a Settings rail section.
 *
 * Panels are ordered independently from sections so unrelated features can
 * compose into Organization (or any other registered section) without
 * replacing one another.
 */
export interface SettingsPanelDescriptor {
  id: string;
  section: SettingsSectionId;
  /** Stable order inside the target section. Existing entries must not be reordered. */
  order: number;
  labelKey?: string;
  flagId?: FlagId;
  definitions?:
    | readonly SettingDefinition[]
    | (() => readonly SettingDefinition[]);
  groups?: readonly SettingsGroupDescriptor[];
  searchTerms?: readonly string[];
  render: (props: SettingsSectionRenderProps) => ReactNode;
}
