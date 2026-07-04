/**
 * cleanup3 — AuditActionType union coverage.
 *
 * The Rust side writes several action strings that the TS union and the
 * audit-log UI's label/icon/category maps never learned (found while fixing
 * `audit_integrity_reseal`, which needed a cast in audit-persistence.test.ts).
 * This asserts every action string a Rust command actually writes has a real,
 * non-generic label and an icon in the exported maps — not the "unknown
 * action" fallback (`lookupLabel`/`renderActionIcon`'s default in
 * auditHomeHelpers.ts).
 */
import { describe, it, expect } from 'vitest';
import type { AuditActionType } from '@/platform/types/audit';
import { ACTION_LABELS, ACTION_ICONS, ACTION_CATEGORY } from '@/features/audit/auditHomeHelpers';

const RUST_WRITTEN_ACTIONS_ADDED_BY_CLEANUP3: AuditActionType[] = [
  'audit_integrity_reseal',
  'redtail.connect',
  'redtail.sync',
  'redtail.disconnect',
  'salesforce.connect_cancelled',
  'wealthbox.create_note',
  'wealthbox.create_task',
  'wealthbox.field_updated',
];

describe('AuditActionType union — cleanup3 Rust/TS gap audit', () => {
  it.each(RUST_WRITTEN_ACTIONS_ADDED_BY_CLEANUP3)('%s has a real label, icon, and category', (action) => {
    expect(ACTION_LABELS[action]).toBeTruthy();
    expect(ACTION_LABELS[action]).not.toBe(action);
    expect(ACTION_ICONS[action]).toBeTruthy();
    expect(ACTION_CATEGORY[action]).toBeTruthy();
  });
});
