import { createContext, useContext, type ReactNode } from 'react';

export interface CrmHomeSurfaceContextValue {
  navigate: (route: string) => void;
  renderLegacySurface: (id: string) => ReactNode;
}

export const CrmHomeSurfaceContext = createContext<CrmHomeSurfaceContextValue | null>(null);

export function useCrmHomeSurfaceContext(): CrmHomeSurfaceContextValue {
  const value = useContext(CrmHomeSurfaceContext);
  if (!value) throw new Error('CRM home surfaces must render inside CrmHome.');
  return value;
}
