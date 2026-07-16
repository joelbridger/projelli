import { createElement } from 'react';
import { BriefcaseBusiness } from 'lucide-react';
import { CrmShellSurface } from './CrmShellSurface';

declare module '@/platform/types/navigation' {
  interface AppSurfaceMap {
    crm: true;
  }
}

/** The CRM frame's single top-level shell registration. */
export const crmShellSurface = {
  id: 'crm',
  labelKey: 'crm-shell.title',
  icon: BriefcaseBusiness,
  placement: 'primary',
  order: 15,
  clientContext: 'firm',
  errorLabel: 'CRM',
  render: () => createElement(CrmShellSurface),
} as const;
