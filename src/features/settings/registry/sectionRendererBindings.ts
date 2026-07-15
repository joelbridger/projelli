import { createElement, type ReactNode } from 'react';
import type { SettingsSectionId, SettingsSectionRenderProps } from './types';

type SettingsSectionRenderer = (props: SettingsSectionRenderProps) => ReactNode;

const renderers = new Map<SettingsSectionId, SettingsSectionRenderer>();

/** Compatibility bridge while legacy section bodies stay in SettingsContent. */
export function registerSettingsSectionRenderer(
  id: SettingsSectionId,
  renderer: SettingsSectionRenderer,
): void {
  renderers.set(id, renderer);
}

export function renderRegisteredSettingsSection(
  id: SettingsSectionId,
  props: SettingsSectionRenderProps,
): ReactNode {
  const renderer = renderers.get(id);
  if (!renderer) {
    throw new Error(`[settingsModuleRegistry] no renderer registered for ${id}`);
  }
  // Keep each section a React component boundary. Calling a renderer directly
  // would make its hooks part of SettingsContent and change hook order when
  // the active section changes.
  return createElement(renderer, props);
}
