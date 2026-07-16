import { Suspense, lazy } from 'react';
import { useFlag } from '@/platform/flags';
import { LiveCrmHome } from '@/features/crm-home';
import type { CrmShellRuntime } from './runtime';

const CrmShellFrameEnabled = lazy(() =>
  import('./CrmShellFrameEnabled').then((module) => ({
    default: module.CrmShellFrameEnabled,
  }))
);

export interface CrmShellSurfaceProps {
  runtime: CrmShellRuntime;
}

/**
 * The existing Home descriptor is the CRM doorway. The flag check is the first
 * operation so, while dark, its legacy renderer stays exactly in place and the
 * v1 destination registry is never loaded.
 */
export function CrmShellSurface({ runtime }: CrmShellSurfaceProps) {
  if (!useFlag('crm-shell-v1')) return runtime.legacy.home();

  return (
    <Suspense fallback={null}>
      <LiveCrmHome
        {...runtime.crmHomeHandoff}
        render={(runtime) => <CrmShellFrameEnabled {...runtime} />}
      />
    </Suspense>
  );
}
