/**
 * auditHomeHelpers.ts
 * Pure module-scope constants, types, and helper functions extracted from
 * AuditHome.tsx. No React hooks, no component state/props/refs.
 */

import React from 'react';
import { History } from 'lucide-react';
import { getEntityLabelEnglish } from '@/platform/hooks/useEntityLabel';
import type { AuditEntry, AuditActionType } from '@/platform/types/audit';
import {
  ACTION_CATEGORY,
  ACTION_ICONS,
  ACTION_LABELS,
  type ActionCategory,
} from './auditActionRegistry';

export { ACTION_CATEGORY, ACTION_ICONS, ACTION_LABELS };
export type { ActionCategory };
import { asRecord } from './audit-export';

// ── Constants ──────────────────────────────────────────────────────────────

export const PAGE_SIZE = 100;

// ── Typed-map helpers ──────────────────────────────────────────────────────
// Runtime audit entries from old schema may carry action strings not in the
// current enum. These helpers accept `string` so we never get a TS error on
// the lookup, and fall back cleanly when a key is absent.

export type AnyRecord<V> = Record<string, V | undefined>;

export function lookupLabel(
  map: Record<AuditActionType, string>,
  action: string
): string {
  return (map as AnyRecord<string>)[action] ?? action;
}

export function lookupCategory(
  map: Record<AuditActionType, ActionCategory>,
  action: string
): ActionCategory {
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

export const CATEGORY_COLOR: Record<ActionCategory, string> = {
  file: '#16a34a',
  ai: '#7c3aed',
  workflow: '#9333ea',
  privilege: '#4f46e5',
  firm: '#0284c7',
  system: '#64748b',
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
  if (
    entry.action === 'scope_active' ||
    entry.action === 'retrieval_executed'
  ) {
    // English-only escape hatch: this sentence is still hardcoded English
    // (see the cleanup2 handoff), so the noun must stay English too rather
    // than mix a translated word into an English sentence.
    const entityLabel = getEntityLabelEnglish();
    const scope = meta['scope'] as
      | { kind?: string; matterName?: string }
      | undefined;
    if (scope?.kind === 'allMatters') return `All ${entityLabel.other}`;
    if (scope?.kind === 'matter') return scope.matterName ?? entityLabel.One;
  }
  return null;
}
