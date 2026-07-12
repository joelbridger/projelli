import { BarChart3 } from 'lucide-react';
import { Reports } from './Reports';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';

export const reportsSurface: CrmHomeSurfaceDescriptor = { id: 'reports', label: 'Reports', icon: BarChart3, route: 'reports', rail: true, Component: Reports };
