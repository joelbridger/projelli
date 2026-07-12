import { Search } from 'lucide-react';
import { CrmSearchSurface } from './CrmSearchSurface';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';

export const searchSurface: CrmHomeSurfaceDescriptor = { id: 'search', label: 'Search records', icon: Search, route: 'search', rail: true, Component: CrmSearchSurface };
