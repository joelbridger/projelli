import type { ReactNode } from 'react';

/** The only shell capability the v1 Settings frame needs to preserve today. */
export interface SettingsV1Runtime {
  legacy: {
    settings: () => ReactNode;
  };
}
