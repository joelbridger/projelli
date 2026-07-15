import { Landmark, Settings } from 'lucide-react';
import { CrmPipelineSurface } from './CrmPipelineSurface';
import { useCrmHomeSurfaceContext } from '@/features/crm-home/surfaceContext';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    pipeline: true;
    'pipeline-settings': true;
  }
}

function PipelineRoute({ route }: { route: 'pipeline' | 'pipeline-settings' }) {
  const { navigate, addRequest, onAddRequestConsumed } =
    useCrmHomeSurfaceContext();
  return (
    <CrmPipelineSurface
      route={route}
      onNavigate={(next) => {
        navigate(next);
      }}
      {...(addRequest ? { addRequest } : {})}
      {...(onAddRequestConsumed ? { onAddRequestConsumed } : {})}
    />
  );
}

export const pipelineSurface: CrmHomeSurfaceDescriptor = {
  id: 'pipeline',
  labelKey: 'crm.home.destinations.pipeline',
  icon: Landmark,
  route: 'pipeline',
  rail: { group: 'home', order: 150 },
  shortcut: 'p',
  Component: () => <PipelineRoute route="pipeline" />,
};
export const pipelineSettingsSurface: CrmHomeSurfaceDescriptor = {
  id: 'pipeline-settings',
  labelKey: 'crm.home.destinations.pipeline-settings',
  icon: Settings,
  route: 'pipeline-settings',
  parentRoute: 'pipeline',
  Component: () => <PipelineRoute route="pipeline-settings" />,
};
