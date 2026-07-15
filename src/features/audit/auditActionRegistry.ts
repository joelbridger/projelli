import type { ElementType } from 'react';
import {
  CalendarClock,
  CheckCircle,
  Cpu,
  FilePlus,
  FileText,
  FileX,
  Fingerprint,
  FolderInput,
  KeyRound,
  Lock,
  PenLine,
  Play,
  Save,
  Scissors,
  Search as SearchIcon,
  Send,
  Share2,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Target,
  Timer,
  User,
  UserX,
  Users2,
  XCircle,
} from 'lucide-react';
import type { AuditActionType } from '@/platform/types/audit';
import en from '@/locales/en.json';

export type ActionCategory =
  | 'file'
  | 'ai'
  | 'workflow'
  | 'privilege'
  | 'firm'
  | 'system';

/** Public display metadata for an already-written durable audit action. */
export interface AuditActionDescriptor {
  id: AuditActionType;
  /** Translation key owned by the action's feature. */
  labelKey: string;
  /** Compatibility label rendered by the existing audit home. */
  label: string;
  icon: ElementType;
  category: ActionCategory;
}

/**
 * Compatibility descriptors for actions that predate this registry. New
 * feature-owned actions export their own descriptor and map augmentation.
 */
export const legacyAuditActionDescriptors: readonly AuditActionDescriptor[] = [
  {
    id: 'file_create',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'File Created',
    icon: FilePlus,
    category: 'file',
  },
  {
    id: 'file_update',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'File Updated',
    icon: FileText,
    category: 'file',
  },
  {
    id: 'file_delete',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'File Deleted',
    icon: FileX,
    category: 'file',
  },
  {
    id: 'file_move',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'File Moved',
    icon: FolderInput,
    category: 'file',
  },
  {
    id: 'file_rename',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'File Renamed',
    icon: PenLine,
    category: 'file',
  },
  {
    id: 'file_export',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'File Exported',
    icon: Save,
    category: 'file',
  },
  {
    id: 'workflow_start',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Workflow Started',
    icon: Play,
    category: 'workflow',
  },
  {
    id: 'workflow_complete',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Workflow Completed',
    icon: CheckCircle,
    category: 'workflow',
  },
  {
    id: 'workflow_fail',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Workflow Failed',
    icon: XCircle,
    category: 'workflow',
  },
  {
    id: 'model_call',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Model Call',
    icon: Cpu,
    category: 'ai',
  },
  {
    id: 'prompt_preparation',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Private Link Check',
    icon: ShieldCheck,
    category: 'ai',
  },
  {
    id: 'context_compressed',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Context Compressed',
    icon: Scissors,
    category: 'ai',
  },
  {
    id: 'user_action',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'User Action',
    icon: User,
    category: 'system',
  },
  {
    id: 'retrieval_executed',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Files Searched',
    icon: SearchIcon,
    category: 'ai',
  },
  {
    id: 'citation_verified',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Citation Checked',
    icon: ShieldCheck,
    category: 'ai',
  },
  {
    id: 'privilege_evaluated',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Privilege Checked',
    icon: Lock,
    category: 'privilege',
  },
  {
    id: 'scope_active',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Active Client',
    icon: Target,
    category: 'privilege',
  },
  {
    id: 'egress',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'AI Request Sent',
    icon: Send,
    category: 'ai',
  },
  {
    id: 'network_egress',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Network Receipt',
    icon: Send,
    category: 'system',
  },
  {
    id: 'mcp_blocked',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'External AI Write Blocked',
    icon: ShieldOff,
    category: 'privilege',
  },
  {
    id: 'mcp_list',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'External AI Listed Files',
    icon: FileText,
    category: 'privilege',
  },
  {
    id: 'mcp_read',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'External AI Read File',
    icon: FileText,
    category: 'privilege',
  },
  {
    id: 'mcp_search',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'External AI Searched Files',
    icon: SearchIcon,
    category: 'privilege',
  },
  {
    id: 'mcp_write_requested',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'External AI Write Requested',
    icon: PenLine,
    category: 'privilege',
  },
  {
    id: 'mcp_write_approved',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'External AI Write Approved',
    icon: ShieldCheck,
    category: 'privilege',
  },
  {
    id: 'mcp_write_denied',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'External AI Write Denied',
    icon: ShieldOff,
    category: 'privilege',
  },
  {
    id: 'mcp_matter_access_granted',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'External AI Client Access Granted',
    icon: ShieldCheck,
    category: 'privilege',
  },
  {
    id: 'mcp_matter_access_revoked',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'External AI Client Access Revoked',
    icon: ShieldOff,
    category: 'privilege',
  },
  {
    id: 'matter_shared',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Client Shared',
    icon: Share2,
    category: 'firm',
  },
  {
    id: 'matter_unshared',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Client Unshared',
    icon: Share2,
    category: 'firm',
  },
  {
    id: 'member_invited',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Member Invited',
    icon: Users2,
    category: 'firm',
  },
  {
    id: 'member_removed',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Member Removed',
    icon: Users2,
    category: 'firm',
  },
  {
    id: 'wall_set_from_manager',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Information Barrier Set',
    icon: ShieldOff,
    category: 'firm',
  },
  {
    id: 'key_published',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Key Published',
    icon: KeyRound,
    category: 'firm',
  },
  {
    id: 'seat_revoked',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Seat Revoked',
    icon: UserX,
    category: 'firm',
  },
  {
    id: 'wealthbox.connect',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Wealthbox Connected',
    icon: Users2,
    category: 'system',
  },
  {
    id: 'wealthbox.sync',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Wealthbox Synced',
    icon: Users2,
    category: 'system',
  },
  {
    id: 'wealthbox.disconnect',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Wealthbox Disconnected',
    icon: Users2,
    category: 'system',
  },
  {
    id: 'onedrive.sync',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'OneDrive Synced',
    icon: Users2,
    category: 'system',
  },
  {
    id: 'mail.sync',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Mail Synced',
    icon: Users2,
    category: 'system',
  },
  {
    id: 'box.sync',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Box Synced',
    icon: Users2,
    category: 'system',
  },
  {
    id: 'calendly.sync',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Calendly Synced',
    icon: Users2,
    category: 'system',
  },
  {
    id: 'calendar.sync',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Calendar Synced',
    icon: Users2,
    category: 'system',
  },
  {
    id: 'addepar.sync',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Addepar Synced',
    icon: Users2,
    category: 'system',
  },
  {
    id: 'salesforce.connect',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Salesforce Connected',
    icon: Users2,
    category: 'system',
  },
  {
    id: 'salesforce.sync',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Salesforce Synced',
    icon: Users2,
    category: 'system',
  },
  {
    id: 'salesforce.disconnect',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Salesforce Disconnected',
    icon: Users2,
    category: 'system',
  },
  {
    id: 'email.send',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Email Sent',
    icon: Send,
    category: 'system',
  },
  {
    id: 'email.draft_saved',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Draft Saved',
    icon: Save,
    category: 'system',
  },
  {
    id: 'intake_nudge',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Intake Nudge',
    icon: Save,
    category: 'system',
  },
  {
    id: 'intake_email_reply',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Email Reply Intake',
    icon: Save,
    category: 'system',
  },
  {
    id: 'intake_doc_extraction',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Document Fact Review',
    icon: Save,
    category: 'system',
  },
  {
    id: 'external_export_consent',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Exported-Report Consent',
    icon: ShieldCheck,
    category: 'privilege',
  },
  {
    id: 'acats.approve',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'ACATS Draft Approved',
    icon: ShieldCheck,
    category: 'file',
  },
  {
    id: 'acats.export',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'ACATS Packet Exported',
    icon: Save,
    category: 'file',
  },
  {
    id: 'template_installed_from_marketplace',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Template Installed',
    icon: FilePlus,
    category: 'system',
  },
  {
    id: 'template_uninstalled',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Template Uninstalled',
    icon: FileX,
    category: 'system',
  },
  {
    id: 'template_updated',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Template Updated',
    icon: PenLine,
    category: 'system',
  },
  {
    id: 'template_install_failed',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Template Install Failed',
    icon: XCircle,
    category: 'system',
  },
  {
    id: 'beneficiary_finding_dismissed',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Beneficiary Check Dismissed',
    icon: ShieldCheck,
    category: 'privilege',
  },
  {
    id: 'client_map_bullet_added',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Client Map Bullet Added',
    icon: FilePlus,
    category: 'file',
  },
  {
    id: 'client_map_bullet_edited',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Client Map Bullet Edited',
    icon: PenLine,
    category: 'file',
  },
  {
    id: 'client_map_bullet_removed',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Client Map Bullet Removed',
    icon: FileX,
    category: 'file',
  },
  {
    id: 'client_map_section_removed',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Client Map Section Removed',
    icon: FileX,
    category: 'file',
  },
  {
    id: 'voiceprint_enrolled',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Voice profile saved',
    icon: Fingerprint,
    category: 'file',
  },
  {
    id: 'voiceprint_consent',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Voice profile consent confirmed',
    icon: Fingerprint,
    category: 'file',
  },
  {
    id: 'voiceprint_deleted',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Voice profile deleted',
    icon: Fingerprint,
    category: 'file',
  },
  {
    id: 'retention_delete',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Retention Removed a File',
    icon: Timer,
    category: 'file',
  },
  {
    id: 'retention_swept',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Retention Sweep Finished',
    icon: Timer,
    category: 'file',
  },
  {
    id: 'meeting_redaction',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Meeting Content Redacted',
    icon: Scissors,
    category: 'file',
  },
  {
    id: 'meeting_capture_started',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Meeting Recording Started',
    icon: FilePlus,
    category: 'system',
  },
  {
    id: 'meeting_auto_join_started',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Meeting Auto-Join Started',
    icon: CalendarClock,
    category: 'system',
  },
  {
    id: 'meeting_recorded',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Meeting Recorded',
    icon: FileText,
    category: 'system',
  },
  {
    id: 'meeting_audio_deleted',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Meeting Audio Deleted',
    icon: FileX,
    category: 'file',
  },
  {
    id: 'audit_integrity_reseal',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Audit Log Integrity Gap Repaired',
    icon: ShieldAlert,
    category: 'privilege',
  },
  {
    id: 'redtail.connect',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Redtail Connected',
    icon: Users2,
    category: 'system',
  },
  {
    id: 'redtail.sync',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Redtail Synced',
    icon: Users2,
    category: 'system',
  },
  {
    id: 'redtail.disconnect',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Redtail Disconnected',
    icon: Users2,
    category: 'system',
  },
  {
    id: 'salesforce.connect_cancelled',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Salesforce Connect Cancelled',
    icon: XCircle,
    category: 'system',
  },
  {
    id: 'wealthbox.create_note',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Wealthbox Note Created',
    icon: FilePlus,
    category: 'system',
  },
  {
    id: 'wealthbox.create_task',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Wealthbox Task Created',
    icon: FilePlus,
    category: 'system',
  },
  {
    id: 'wealthbox.field_updated',
    labelKey: 'layout.sidebar.tabs.audit',
    label: 'Wealthbox Field Updated',
    icon: PenLine,
    category: 'system',
  },
];

/** Append-only public mount list; audit writes and business logic stay outside. */
export const auditActionRegistry: readonly AuditActionDescriptor[] =
  legacyAuditActionDescriptors;

export function validateAuditActionDescriptors(
  descriptors: readonly AuditActionDescriptor[],
  localeKeyExists: (key: string) => boolean
): void {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) {
      throw new Error(
        `[auditActionRegistry] duplicate audit action id: ${descriptor.id}`
      );
    }
    ids.add(descriptor.id);
    if (!descriptor.labelKey.includes('.')) {
      throw new Error(
        `[auditActionRegistry] labelKey must include a namespace: ${descriptor.id}`
      );
    }
    if (!localeKeyExists(descriptor.labelKey)) {
      throw new Error(
        `[auditActionRegistry] unresolved locale key: ${descriptor.labelKey}`
      );
    }
  }
}

export function auditActionLocaleKeyExists(key: string): boolean {
  let value: unknown = en;
  for (const segment of key.split('.')) {
    if (!value || typeof value !== 'object' || !(segment in value)) {
      return false;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === 'string' && value.trim().length > 0;
}

validateAuditActionDescriptors(auditActionRegistry, auditActionLocaleKeyExists);

const actionDescriptorsById = new Map(
  auditActionRegistry.map((descriptor) => [descriptor.id, descriptor])
);

export function getAuditActionDescriptor(
  action: string
): AuditActionDescriptor | undefined {
  return actionDescriptorsById.get(action as AuditActionType);
}

export const ACTION_ICONS: Record<AuditActionType, ElementType> =
  Object.fromEntries(
    auditActionRegistry.map((descriptor) => [descriptor.id, descriptor.icon])
  ) as Record<AuditActionType, ElementType>;

export const ACTION_LABELS: Record<AuditActionType, string> =
  Object.fromEntries(
    auditActionRegistry.map((descriptor) => [descriptor.id, descriptor.label])
  ) as Record<AuditActionType, string>;

export const ACTION_CATEGORY: Record<AuditActionType, ActionCategory> =
  Object.fromEntries(
    auditActionRegistry.map((descriptor) => [
      descriptor.id,
      descriptor.category,
    ])
  ) as Record<AuditActionType, ActionCategory>;
