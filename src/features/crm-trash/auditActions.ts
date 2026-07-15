import { ArchiveRestore, ShieldAlert, Trash2 } from 'lucide-react';
import type { AuditActionDescriptor } from '@/features/audit/auditActionRegistry';

declare module '@/platform/types/audit' {
  interface AuditActionMap {
    crm_record_soft_deleted: true;
    crm_record_restored: true;
    crm_record_purge_refused: true;
  }
}

/** Audit display metadata for the durable CRM trash lifecycle. */
export const trashAuditActionDescriptors: readonly AuditActionDescriptor[] = [
  {
    id: 'crm_record_soft_deleted',
    labelKey: 'crm.trash.audit-soft-deleted',
    label: 'CRM Record Moved to Trash',
    icon: Trash2,
    category: 'system',
  },
  {
    id: 'crm_record_restored',
    labelKey: 'crm.trash.audit-restored',
    label: 'CRM Record Restored',
    icon: ArchiveRestore,
    category: 'system',
  },
  {
    id: 'crm_record_purge_refused',
    labelKey: 'crm.trash.audit-purge-refused',
    label: 'CRM Permanent Deletion Refused',
    icon: ShieldAlert,
    category: 'privilege',
  },
];
