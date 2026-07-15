import { createElement, type ReactNode } from 'react';
import { getSettingsPanelDescriptors } from './settingsModuleRegistry';
import type {
  SettingsPanelDescriptor,
  SettingsSectionId,
  SettingsSectionRenderProps,
} from './types';

type SettingsSectionRenderer = (props: SettingsSectionRenderProps) => ReactNode;

const renderers = new Map<SettingsSectionId, SettingsSectionRenderer>();

/** Compatibility bridge while legacy section bodies stay in SettingsContent. */
export function registerSettingsSectionRenderer(
  id: SettingsSectionId,
  renderer: SettingsSectionRenderer
): void {
  renderers.set(id, renderer);
}

export function renderRegisteredSettingsSection(
  id: SettingsSectionId,
  props: SettingsSectionRenderProps
): ReactNode {
  const renderer = renderers.get(id);
  if (!renderer) {
    throw new Error(
      `[settingsModuleRegistry] no renderer registered for ${id}`
    );
  }
  // Keep each section a React component boundary. Calling a renderer directly
  // would make its hooks part of SettingsContent and change hook order when
  // the active section changes.
  return createElement(renderer, props);
}

function SettingsPanelBoundary({
  panel,
  props,
}: {
  panel: SettingsPanelDescriptor;
  props: SettingsSectionRenderProps;
}): ReactNode {
  // This must stay a component boundary. Calling panel.render directly would
  // fold a panel's hooks into SettingsContent and make hook order depend on
  // which feature flags or section the user is viewing.
  return createElement(panel.render, props);
}

/** Render all visible panels in a section, in their registered panel order. */
export function renderRegisteredSettingsPanels(
  id: SettingsSectionId,
  props: SettingsSectionRenderProps
): ReactNode {
  return getSettingsPanelDescriptors(id).map((panel) =>
    createElement(SettingsPanelBoundary, { key: panel.id, panel, props })
  );
}
