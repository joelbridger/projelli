// Shared email-surface audit-log plumbing — pulled out of EmailViewer.tsx so
// that other email-adjacent surfaces (DraftFollowUpModal) can log the same
// egress audit shape without importing EmailViewer's whole component tree
// (which drags along its component-scoped mocks/dependencies in tests).
import type { AuditEntry, AuditScope } from '@/platform/types/audit';
import type { ConfidentialityMode, EgressDestination } from '@/platform/privacy/egress';

/**
 * The matter-scope payload for an email audit entry: filed emails are scoped
 * by matterId (kept even when the matter object itself isn't in the current
 * list — e.g. archived, per BUG-013) so the per-matter confidentiality
 * report/Activity view doesn't drop the row as unscoped legacy data. Shared
 * by both the AI-draft egress row and the outbound-send row so a client's
 * emails show up in that client's Activity view either way.
 */
export function emailMatterScope(filedMatterId: string | null, filedMatterName: string | undefined): AuditScope | undefined {
  if (filedMatterId === null) return undefined;
  return { kind: 'matter', matterId: filedMatterId, ...(filedMatterName ? { matterName: filedMatterName } : {}) };
}

/**
 * The confidentiality-mode LABEL an audit entry should carry, derived from
 * where the request ACTUALLY went — not the app's raw confidentiality-mode
 * SETTING (independent reviewer catch, P1). Email's "no cloud key" and
 * "assured selected but no managed key" branches routinely diverge from the
 * setting in normal operation (unlike Ask/Chat, which either match the
 * setting or refuse to send), so storing the raw setting here would make
 * `buildConfidentialityReport()`'s per-mode grouping/attestation describe a
 * local-fallback draft as "went to your provider under your own key", or a
 * BYOK fallback as "went through the zero-retention proxy".
 */
export function effectiveModeForDestination(destination: EgressDestination): ConfidentialityMode {
  switch (destination) {
    case 'local': return 'local-only';
    case 'assured-proxy': return 'assured';
    default: return 'direct'; // 'provider-direct' | 'demo-proxy' (email never demos)
  }
}

// ── Audit ─────────────────────────────────────────────────────────────────
// A client's email is confidential content; every path that lets it leave the
// device (an AI draft) or leave the firm (a sent reply) must leave a durable
// record — the same guarantee every other AI surface (Ask, redline, Client
// Map) already gives, in the SAME live Activity Log / confidentiality report
// (not a separate audit bucket only visible after a workspace re-hydrate).
//
// EmailViewer's (and DraftFollowUpModal's) only parent is MainPanel.tsx
// (owned by another workstream), so neither can take an `onAuditLog` prop the
// way Ask does. Instead App registers its main audit emitter here, mirroring
// matterStore.ts's `setMatterAuditEmitter` — the same pattern that lets a
// non-prop-threaded module (the matter store) still reach the live audit
// state.
type EmailAuditEmitter = (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
let activeEmailAuditEmitter: EmailAuditEmitter | null = null;

export function setEmailAuditEmitter(emitter: EmailAuditEmitter | null): void {
  activeEmailAuditEmitter = emitter;
}

export function logEmailAuditEntry(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void {
  activeEmailAuditEmitter?.(entry);
}
