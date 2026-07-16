import type { ReactNode } from 'react';

/** The only legacy capability the CRM shell gate needs while dark. */
export interface CrmShellRuntime {
  legacy: {
    home: () => ReactNode;
  };
}
