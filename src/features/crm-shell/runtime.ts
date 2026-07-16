import type { ReactNode } from 'react';
import type { CrmHomeProps } from '@/features/crm-home';

/** The only legacy capability the CRM shell gate needs while dark. */
export interface CrmShellRuntime {
  legacy: {
    home: () => ReactNode;
  };
  crmHomeHandoff?: Pick<
    CrmHomeProps,
    'initialRoute' | 'addRequest' | 'onAddRequestConsumed'
  >;
}
