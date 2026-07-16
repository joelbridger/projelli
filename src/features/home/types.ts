import type { ReactNode } from 'react';
import type { SettingCategory } from '@/platform/settings/schema';
import type { Matter } from '@/platform/types/matter';
import type { AppSurface } from '@/platform/types/navigation';

/** The narrow shell doorway the Home surface is allowed to use. */
export interface HomeSurfaceRuntime {
  navigation: {
    setSurface: (surface: AppSurface) => void;
  };
  workspace: {
    rootPath: string | null | undefined;
    activeMatter: Matter | null;
  };
  settings: {
    open: (category?: SettingCategory) => void;
  };
}

export interface HomeSurfaceFlagGateProps {
  runtime: HomeSurfaceRuntime;
  /** The unchanged legacy renderer remains the only flag-off branch. */
  renderLegacy: () => ReactNode;
}
