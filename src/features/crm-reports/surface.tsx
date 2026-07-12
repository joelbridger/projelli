import { BarChart3 } from 'lucide-react';
import { CrmReports } from './CrmReports';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';

export const reportsSurface: CrmHomeSurfaceDescriptor = { id: 'reports', label: 'Reports', icon: BarChart3, route: 'reports', rail: true, Component: CrmReports };
