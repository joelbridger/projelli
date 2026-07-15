import type { ReactNode } from 'react';
import type { AuditEntry } from '@/platform/types/audit';
import type {
  AccountSectionId,
} from '@/platform/types/account';

/** A feature-owned tab in the Account window. */
export interface AccountSectionDescriptor {
  /** Stable id used by deep links and the selected Account tab. */
  id: AccountSectionId;
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
