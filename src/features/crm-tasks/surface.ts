import { ClipboardList } from 'lucide-react';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';
import { TasksSurface } from './Tasks';

export const tasksSurface: CrmHomeSurfaceDescriptor = {
  id: 'tasks', label: 'Tasks', icon: ClipboardList, route: 'tasks', rail: true, Component: TasksSurface,
};
