/**
 * auditHomeHelpers.ts
 * Pure module-scope constants, types, and helper functions extracted from
 * AuditHome.tsx. No React hooks, no component state/props/refs.
 */

import React from 'react';
import { getEntityLabelEnglish } from '@/platform/hooks/useEntityLabel';
import {
  History,
  FilePlus,
  FileText,
  FileX,
  FolderInput,
  PenLine,
  Play,
  CheckCircle,
  XCircle,
  Cpu,
  Scissors,
  User,
  Search as SearchIcon,
  ShieldCheck,
  ShieldOff,
  ShieldAlert,
  Lock,
  Fingerprint,
  Target,
  Send,
  Share2,
  Users2,
  KeyRound,
  UserX,
  Save,
  Timer,
  CalendarClock,
} from 'lucide-react';
import type { AuditEntry, AuditActionType } from '@/platform/types/audit';
import { asRecord } from './audit-export';

// ── Constants ──────────────────────────────────────────────────────────────

export const PAGE_SIZE = 100;

// ── Typed-map helpers ──────────────────────────────────────────────────────
// Runtime audit entries from old schema may carry action strings not in the
// current enum. These helpers accept `string` so we never get a TS error on
// the lookup, and fall back cleanly when a key is absent.

export type AnyRecord<V> = Record<string, V | undefined>;

export function lookupLabel(map: Record<AuditActionType, string>, action: string): string {
  return (map as AnyRecord<string>)[action] ?? action;
}

export function lookupCategory(map: Record<AuditActionType, ActionCategory>, action: string): ActionCategory {
  return (map as AnyRecord<ActionCategory>)[action] ?? 'system';
}

export function toSafeString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Render an action icon without creating a component variable during render. */
export function renderActionIcon(
  map: Record<AuditActionType, React.ElementType>,
  action: string,
  style: React.CSSProperties
): React.ReactNode {
  const Comp = (map as AnyRecord<React.ElementType>)[action] ?? History;
  return React.createElement(Comp, { style });
}

// ── Action metadata ────────────────────────────────────────────────────────

export const ACTION_ICONS: Record<AuditActionType, React.ElementType> = {
  file_create: FilePlus,
  file_update: FileText,
  file_delete: FileX,
  file_move: FolderInput,
  file_rename: PenLine,
  file_export: Save,
  workflow_start: Play,
  workflow_complete: CheckCircle,
  workflow_fail: XCircle,
  model_call: Cpu,
  context_compressed: Scissors,
  user_action: User,
  retrieval_executed: SearchIcon,
  citation_verified: ShieldCheck,
  privilege_evaluated: Lock,
  scope_active: Target,
  egress: Send,
  mcp_blocked: ShieldOff,
  mcp_list: FileText,
  mcp_read: FileText,
  mcp_search: SearchIcon,
  mcp_write_requested: PenLine,
  mcp_write_approved: ShieldCheck,
  mcp_write_denied: ShieldOff,
  mcp_matter_access_granted: ShieldCheck,
  mcp_matter_access_revoked: ShieldOff,
  matter_shared: Share2,
  matter_unshared: Share2,
  member_invited: Users2,
  member_removed: Users2,
  wall_set_from_manager: ShieldOff,
  key_published: KeyRound,
  seat_revoked: UserX,
  // Wealthbox CRM connector.
  'wealthbox.connect': Users2,
  'wealthbox.sync': Users2,
  'wealthbox.disconnect': Users2,
  'onedrive.sync': Users2,
  'mail.sync': Users2,
  'box.sync': Users2,
  'calendly.sync': Users2,
  'calendar.sync': Users2,
  'addepar.sync': Users2,
  'salesforce.connect': Users2,
  'salesforce.sync': Users2,
  'salesforce.disconnect': Users2,
  'email.send': Send,
  'email.draft_saved': Save,
  intake_nudge: Save,
  intake_email_reply: Save,
  intake_doc_extraction: Save,
  external_export_consent: ShieldCheck,
  // Marketplace template lifecycle.
  template_installed_from_marketplace: FilePlus,
  template_uninstalled: FileX,
  template_updated: PenLine,
  template_install_failed: XCircle,
  beneficiary_finding_dismissed: ShieldCheck,
  client_map_bullet_added: FilePlus,
  client_map_bullet_edited: PenLine,
  client_map_bullet_removed: FileX,
  client_map_section_removed: FileX,
  voiceprint_enrolled: Fingerprint,
  voiceprint_consent: Fingerprint,
  voiceprint_deleted: Fingerprint,
  retention_delete: Timer,
  retention_swept: Timer,
  meeting_redaction: Scissors,
  meeting_capture_started: FilePlus,
  meeting_auto_join_started: CalendarClock,
  meeting_recorded: FileText,
  meeting_audio_deleted: FileX,
  audit_integrity_reseal: ShieldAlert,
  'redtail.connect': Users2,
  'redtail.sync': Users2,
  'redtail.disconnect': Users2,
  'salesforce.connect_cancelled': XCircle,
  'wealthbox.create_note': FilePlus,
  'wealthbox.create_task': FilePlus,
  'wealthbox.field_updated': PenLine,
};

export const ACTION_LABELS: Record<AuditActionType, string> = {
  file_create: 'File Created',
  file_update: 'File Updated',
  file_delete: 'File Deleted',
  file_move: 'File Moved',
  file_rename: 'File Renamed',
  file_export: 'File Exported',
  workflow_start: 'Workflow Started',
  workflow_complete: 'Workflow Completed',
  workflow_fail: 'Workflow Failed',
  model_call: 'Model Call',
  context_compressed: 'Context Compressed',
  user_action: 'User Action',
  retrieval_executed: 'Files Searched',
  citation_verified: 'Citation Checked',
  privilege_evaluated: 'Privilege Checked',
  scope_active: 'Active Client',
  egress: 'AI Request Sent',
  mcp_blocked: 'External AI Write Blocked',
  mcp_list: 'External AI Listed Files',
  mcp_read: 'External AI Read File',
  mcp_search: 'External AI Searched Files',
  mcp_write_requested: 'External AI Write Requested',
  mcp_write_approved: 'External AI Write Approved',
  mcp_write_denied: 'External AI Write Denied',
  mcp_matter_access_granted: 'External AI Client Access Granted',
  mcp_matter_access_revoked: 'External AI Client Access Revoked',
  matter_shared: 'Client Shared',
  matter_unshared: 'Client Unshared',
  member_invited: 'Member Invited',
  member_removed: 'Member Removed',
  wall_set_from_manager: 'Information Barrier Set',
  key_published: 'Key Published',
  seat_revoked: 'Seat Revoked',
  // Wealthbox CRM connector.
  'wealthbox.connect': 'Wealthbox Connected',
  'wealthbox.sync': 'Wealthbox Synced',
  'wealthbox.disconnect': 'Wealthbox Disconnected',
  'onedrive.sync': 'OneDrive Synced',
  'mail.sync': 'Mail Synced',
  'box.sync': 'Box Synced',
  'calendly.sync': 'Calendly Synced',
  'calendar.sync': 'Calendar Synced',
  'addepar.sync': 'Addepar Synced',
  'salesforce.connect': 'Salesforce Connected',
  'salesforce.sync': 'Salesforce Synced',
  'salesforce.disconnect': 'Salesforce Disconnected',
  'email.send': 'Email Sent',
  'email.draft_saved': 'Draft Saved',
  intake_nudge: 'Intake Nudge',
  intake_email_reply: 'Email Reply Intake',
  intake_doc_extraction: 'Document Fact Review',
  external_export_consent: 'Exported-Report Consent',
  // Marketplace template lifecycle.
  template_installed_from_marketplace: 'Template Installed',
  template_uninstalled: 'Template Uninstalled',
  template_updated: 'Template Updated',
  template_install_failed: 'Template Install Failed',
  beneficiary_finding_dismissed: 'Beneficiary Check Dismissed',
  client_map_bullet_added: 'Client Map Bullet Added',
  client_map_bullet_edited: 'Client Map Bullet Edited',
  client_map_bullet_removed: 'Client Map Bullet Removed',
  client_map_section_removed: 'Client Map Section Removed',
  voiceprint_enrolled: 'Voice profile saved',
  voiceprint_consent: 'Voice profile consent confirmed',
  voiceprint_deleted: 'Voice profile deleted',
  retention_delete: 'Retention Removed a File',
  retention_swept: 'Retention Sweep Finished',
  meeting_redaction: 'Meeting Content Redacted',
  meeting_capture_started: 'Meeting Recording Started',
  meeting_auto_join_started: 'Meeting Auto-Join Started',
  meeting_recorded: 'Meeting Recorded',
  meeting_audio_deleted: 'Meeting Audio Deleted',
  audit_integrity_reseal: 'Audit Log Integrity Gap Repaired',
  'redtail.connect': 'Redtail Connected',
  'redtail.sync': 'Redtail Synced',
  'redtail.disconnect': 'Redtail Disconnected',
  'salesforce.connect_cancelled': 'Salesforce Connect Cancelled',
  'wealthbox.create_note': 'Wealthbox Note Created',
  'wealthbox.create_task': 'Wealthbox Task Created',
  'wealthbox.field_updated': 'Wealthbox Field Updated',
};

/** Semantic category per action, drives colour + grouping in filters. */
export type ActionCategory = 'file' | 'ai' | 'workflow' | 'privilege' | 'firm' | 'system';

export const ACTION_CATEGORY: Record<AuditActionType, ActionCategory> = {
  file_create: 'file',
  file_update: 'file',
  file_delete: 'file',
  file_move: 'file',
  file_rename: 'file',
  file_export: 'file',
  workflow_start: 'workflow',
  workflow_complete: 'workflow',
  workflow_fail: 'workflow',
  model_call: 'ai',
  context_compressed: 'ai',
  user_action: 'system',
  retrieval_executed: 'ai',
  citation_verified: 'ai',
  privilege_evaluated: 'privilege',
  scope_active: 'privilege',
  egress: 'ai',
  mcp_blocked: 'privilege',
  mcp_list: 'privilege',
  mcp_read: 'privilege',
  mcp_search: 'privilege',
  mcp_write_requested: 'privilege',
  mcp_write_approved: 'privilege',
  mcp_write_denied: 'privilege',
  mcp_matter_access_granted: 'privilege',
  mcp_matter_access_revoked: 'privilege',
  matter_shared: 'firm',
  matter_unshared: 'firm',
  member_invited: 'firm',
  member_removed: 'firm',
  wall_set_from_manager: 'firm',
  key_published: 'firm',
  seat_revoked: 'firm',
  // Wealthbox CRM connector.
  'wealthbox.connect': 'system',
  'wealthbox.sync': 'system',
  'wealthbox.disconnect': 'system',
  'onedrive.sync': 'system',
  'mail.sync': 'system',
  'box.sync': 'system',
  'calendly.sync': 'system',
  'calendar.sync': 'system',
  'addepar.sync': 'system',
  'salesforce.connect': 'system',
  'salesforce.sync': 'system',
  'salesforce.disconnect': 'system',
  'email.send': 'system',
  'email.draft_saved': 'system',
  intake_nudge: 'system',
  intake_email_reply: 'system',
  intake_doc_extraction: 'system',
  external_export_consent: 'privilege',
  // Marketplace template lifecycle.
  template_installed_from_marketplace: 'system',
  template_uninstalled: 'system',
  template_updated: 'system',
  template_install_failed: 'system',
  beneficiary_finding_dismissed: 'privilege',
  client_map_bullet_added: 'file',
  client_map_bullet_edited: 'file',
  client_map_bullet_removed: 'file',
  client_map_section_removed: 'file',
  voiceprint_enrolled: 'file',
  voiceprint_consent: 'file',
  voiceprint_deleted: 'file',
  retention_delete: 'file',
  retention_swept: 'file',
  meeting_redaction: 'file',
  meeting_capture_started: 'system',
  meeting_auto_join_started: 'system',
  meeting_recorded: 'system',
  meeting_audio_deleted: 'file',
  audit_integrity_reseal: 'privilege',
  'redtail.connect': 'system',
  'redtail.sync': 'system',
  'redtail.disconnect': 'system',
  'salesforce.connect_cancelled': 'system',
  'wealthbox.create_note': 'system',
  'wealthbox.create_task': 'system',
  'wealthbox.field_updated': 'system',
};

export const CATEGORY_COLOR: Record<ActionCategory, string> = {
  file: '#16a34a',    // green-600
  ai: '#7c3aed',     // violet-600
  workflow: '#9333ea', // purple-600
  privilege: '#4f46e5', // indigo-600
  firm: '#0284c7',   // sky-600
  system: '#64748b', // slate-500
};

export const CATEGORY_BG: Record<ActionCategory, string> = {
  file: 'rgba(22,163,74,0.10)',
  ai: 'rgba(124,58,237,0.09)',
  workflow: 'rgba(147,51,234,0.09)',
  privilege: 'rgba(79,70,229,0.09)',
  firm: 'rgba(2,132,199,0.09)',
  system: 'rgba(100,116,139,0.09)',
};

export const CATEGORY_LABEL: Record<ActionCategory, string> = {
  file: 'File ops',
  ai: 'AI Requests',
  workflow: 'Workflow',
  privilege: 'Privilege',
  firm: 'Firm',
  system: 'System',
};

// ── Helpers ────────────────────────────────────────────────────────────────

export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatFullTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── Scope pill ─────────────────────────────────────────────────────────────

/** Reads confidentiality scope from egress / scope_active metadata if present. */
export function getScopeLabel(entry: AuditEntry): string | null {
  const meta = asRecord(entry.metadata);
  if (entry.action === 'egress') {
    const mode = meta['mode'];
    if (mode === 'local-only') return 'Local';
    if (mode === 'direct') return 'Direct';
    if (mode === 'assured') return 'Assured';
  }
  if (entry.action === 'scope_active' || entry.action === 'retrieval_executed') {
    // English-only escape hatch: this sentence is still hardcoded English
    // (see the cleanup2 handoff), so the noun must stay English too rather
    // than mix a translated word into an English sentence.
    const entityLabel = getEntityLabelEnglish();
    const scope = meta['scope'] as { kind?: string; matterName?: string } | undefined;
    if (scope?.kind === 'allMatters') return `All ${entityLabel.other}`;
    if (scope?.kind === 'matter') return scope.matterName ?? entityLabel.One;
  }
  return null;
}
