import type { ReactNode } from 'react';
import {
  AppSurfaceRuntimeContext,
  type AppSurfaceCapabilities,
} from '@/app/shell/runtime/AppSurfaceRuntime';

export function AppSurfaceRuntimeProvider({
  value,
  children,
}: {
  value: AppSurfaceCapabilities;
  children: ReactNode;
}) {
  return (
    <AppSurfaceRuntimeContext.Provider value={value}>
      {children}
    </AppSurfaceRuntimeContext.Provider>
  );
}
