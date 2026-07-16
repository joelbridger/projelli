import { createElement } from 'react';
import { Settings } from 'lucide-react';
import { SettingsV1Surface } from './SettingsV1Surface';
import type { SettingsV1Runtime } from './runtime';

declare module '@/platform/types/navigation' {
  interface AppSurfaceMap {
    'settings-v1': true;
  }
}

/** Feature-owned descriptor; the shared registry only appends this mount. */
export const settingsV1Surface = {
  id: 'settings-v1',
  labelKey: 'settings-v1.surface.title',
  icon: Settings,
  placement: 'hidden',
  order: 90,
  clientContext: 'preserve-hidden',
  errorLabel: 'Settings',
  render: (runtime: SettingsV1Runtime) =>
    createElement(SettingsV1Surface, { runtime }),
} as const;
