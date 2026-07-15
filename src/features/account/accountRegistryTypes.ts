import type { ReactNode } from 'react';
import type { AuditEntry } from '@/platform/types/audit';

/** A feature-owned tab in the Account window. */
export interface AccountSectionDescriptor {
  /** Stable id used by deep links and the selected Account tab. */
  id: string;
  /** Reserved translation key; legacy sections retain their existing labels for now. */
  labelKey: string;
  legacyLabel: string;
  placement: 'tab';
  /** Existing sections keep this order. New sections append without moving them. */
  order: number;
  render: (props: AccountSectionRenderProps) => ReactNode;
}

export interface AccountSectionRenderProps {
  auditEntries?: AuditEntry[] | undefined;
}

export type ConnectionCardPlacement = 'connections' | 'developer-tools';

/**
 * A connector-owned Account card. Compatibility cards render their existing
 * panel for all three entry points, since that panel already owns its status
 * and safe-disconnect behavior. A future active-integrations feature can
 * provide purpose-built status/disconnect renderers without changing the
 * Account window.
 */
export interface ConnectionCardDescriptor {
  id: string;
  labelKey: string;
  placement: ConnectionCardPlacement;
  order: number;
  render: () => ReactNode;
  renderStatus: () => ReactNode;
  renderSafeDisconnect: () => ReactNode;
}
