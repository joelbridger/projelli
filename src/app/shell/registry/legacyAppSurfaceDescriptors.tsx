import { createElement } from 'react';
import {
  Bot,
  CalendarDays,
  FileSearch,
  Files,
  Home,
  Mail,
  Map as MapIcon,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Workflow,
} from 'lucide-react';
import type {
  AppSurfaceComponent,
  AppSurfaceDescriptor,
  AppSurfaceId,
  AppSurfacePlacement,
} from '@/app/shell/registry/types';
import { LegacyMainPanelSurface } from '@/app/shell/registry/LegacyMainPanelSurface';
import { HomeSurfaceFlagGate } from '@/features/home';
import { CrmShellSurface } from '@/features/crm-shell';
import { SettingsV1Surface } from '@/features/settings';

type LegacyDescriptorOptions = {
  id: AppSurfaceId;
  labelKey: string;
  legacyLabel?: string;
  icon: AppSurfaceDescriptor['icon'];
  placement: AppSurfacePlacement;
  order: number;
  clientContext: AppSurfaceDescriptor['clientContext'];
  errorLabel: string;
  render: AppSurfaceDescriptor['render'];
  Component?: AppSurfaceComponent;
};

function legacySurface(options: LegacyDescriptorOptions): AppSurfaceDescriptor {
  const { Component: ProvidedComponent, ...descriptor } = options;
  const Component: AppSurfaceComponent =
    ProvidedComponent ?? (({ runtime }) => options.render(runtime));

  return {
    ...descriptor,
    render: (runtime) => createElement(Component, { runtime }),
  };
}

/**
 * Compatibility descriptors for the pre-registry shell. They stay beside the
 * legacy runtime adapter; appSurfaceRegistry remains the one ordered mount
 * list. New surfaces own their descriptor in their feature module.
 */
export const legacyHomeSurface = legacySurface({
  id: 'home',
  labelKey: 'app-surface.rail.today',
  icon: Home,
  placement: 'primary',
  order: 10,
  clientContext: 'firm',
  errorLabel: 'Home',
  // Two dark features swap this one legacy doorway. Precedence when both are
  // enabled: the Home orientation surface owns `home` (per the frozen
  // prototype); the CRM v1 frame holds this slot only while home-surface-v1
  // is dark, and itself falls back to the exact legacy home when its own
  // flag is off.
  render: (runtime) =>
    createElement(HomeSurfaceFlagGate, {
      runtime,
      renderLegacy: () => createElement(CrmShellSurface, { runtime }),
    }),
});

export const legacyClientsSurface = legacySurface({
  id: 'matters',
  labelKey: 'app-surface.rail.crm',
  icon: MapIcon,
  placement: 'primary',
  order: 20,
  clientContext: 'shared',
  errorLabel: 'Clients',
  render: (runtime) => runtime.legacy.clients(),
});

export const legacyAskSurface = legacySurface({
  id: 'search',
  labelKey: 'app-surface.rail.ask',
  icon: Sparkles,
  placement: 'primary',
  order: 30,
  clientContext: 'shared',
  errorLabel: 'Ask',
  render: (runtime) => runtime.legacy.ask(),
});

export const legacySchedulingSurface = legacySurface({
  id: 'scheduling',
  labelKey: 'scheduling.surface.topbar-label',
  icon: CalendarDays,
  placement: 'utility',
  order: 10,
  clientContext: 'preserve-hidden',
  errorLabel: 'Scheduling',
  render: (runtime) => runtime.legacy.scheduling(),
});

export const legacySettingsSurface = legacySurface({
  id: 'settings',
  labelKey: 'settings.modal.title',
  icon: Settings,
  placement: 'utility',
  order: 20,
  clientContext: 'preserve-hidden',
  errorLabel: 'Settings',
  // This is the one real Settings doorway. The flag gate keeps the legacy
  // surface byte-for-byte intact while dark, then swaps only this descriptor's
  // body to the v1 frame when the feature is enabled.
  render: (runtime) => createElement(SettingsV1Surface, { runtime }),
});

export const legacyDocumentsSurface = legacySurface({
  id: 'files',
  labelKey: 'workspace.documents.title',
  icon: Files,
  placement: 'hidden',
  order: 10,
  clientContext: 'shared',
  errorLabel: 'Documents',
  render: (runtime) => runtime.legacy.documents(),
});

export const legacyEmailSurface = legacySurface({
  id: 'email',
  labelKey: 'mail.workspace.title',
  icon: Mail,
  placement: 'hidden',
  order: 20,
  clientContext: 'shared',
  errorLabel: 'Email',
  render: (runtime) => runtime.legacy.email(),
});

export const legacyWorkflowsSurface = legacySurface({
  id: 'workflows',
  labelKey: 'spine.nav.workflows',
  icon: Workflow,
  placement: 'hidden',
  order: 30,
  clientContext: 'shared',
  errorLabel: 'Workflows',
  render: (runtime) => runtime.legacy.workflows(),
});

export const legacyAuditSurface = legacySurface({
  id: 'audit',
  labelKey: 'layout.sidebar.tabs.audit',
  icon: ScrollText,
  placement: 'hidden',
  order: 40,
  clientContext: 'preserve-hidden',
  errorLabel: 'Activity Log',
  render: (runtime) => runtime.legacy.audit(),
});

export const legacyPrivacySurface = legacySurface({
  id: 'privacy',
  labelKey: 'settings.privacy.title',
  icon: ShieldCheck,
  placement: 'hidden',
  order: 50,
  clientContext: 'preserve-hidden',
  errorLabel: 'Privacy Center',
  render: (runtime) => runtime.legacy.privacy(),
});

export const legacyAiAssistantSurface = legacySurface({
  id: 'ai-assistant',
  labelKey: 'layout.sidebar.tabs.ai-assistant',
  icon: Bot,
  placement: 'hidden',
  order: 60,
  clientContext: 'preserve-hidden',
  errorLabel: 'AI Assistant',
  render: (runtime) => runtime.legacy.mainPanel(),
  Component: LegacyMainPanelSurface,
});

export const legacyResearchSurface = legacySurface({
  id: 'research',
  labelKey: 'layout.sidebar.tabs.research',
  icon: FileSearch,
  placement: 'hidden',
  order: 70,
  clientContext: 'preserve-hidden',
  errorLabel: 'Research',
  render: (runtime) => runtime.legacy.mainPanel(),
  Component: LegacyMainPanelSurface,
});

export const legacyTrashSurface = legacySurface({
  id: 'trash',
  labelKey: 'workspace.documents.trash',
  icon: Trash2,
  placement: 'hidden',
  order: 80,
  clientContext: 'preserve-hidden',
  errorLabel: 'Trash',
  render: (runtime) => runtime.legacy.mainPanel(),
  Component: LegacyMainPanelSurface,
});
