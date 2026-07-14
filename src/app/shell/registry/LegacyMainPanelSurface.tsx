import type { AppSurfaceComponent } from '@/app/shell/registry/types';

export const LegacyMainPanelSurface: AppSurfaceComponent = ({ runtime }) =>
  runtime.legacy.mainPanel();
