import { Landmark, Settings } from 'lucide-react';
import { CrmPipelineSurface } from './CrmPipelineSurface';
import { useCrmHomeSurfaceContext } from '@/features/crm-home/surfaceContext';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';

function PipelineRoute({ route }: { route: 'pipeline' | 'pipeline-settings' }) {
  const { navigate, addRequest, onAddRequestConsumed } = useCrmHomeSurfaceContext();
  return <CrmPipelineSurface
    route={route}
    onNavigate={(next) => { navigate(next); }}
    {...(addRequest ? { addRequest } : {})}
    {...(onAddRequestConsumed ? { onAddRequestConsumed } : {})}
  />;
}

export const pipelineSurface: CrmHomeSurfaceDescriptor = { id: 'pipeline', label: 'Pipeline', icon: Landmark, route: 'pipeline', rail: true, Component: () => <PipelineRoute route="pipeline" /> };
export const pipelineSettingsSurface: CrmHomeSurfaceDescriptor = { id: 'pipeline-settings', label: 'Pipeline settings', icon: Settings, route: 'pipeline-settings', Component: () => <PipelineRoute route="pipeline-settings" /> };
