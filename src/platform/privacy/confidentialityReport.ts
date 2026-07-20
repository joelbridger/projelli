/**
 * Confidentiality Report assembler — pure function, no side-effects.
 *
 * Reads the audit log for a single matter (by scope.matterId or by
 * scope.kind === 'allMatters') and builds a structured, per-matter record
 * that a lawyer can print and keep in the client file.
 *
 * HONESTY CONTRACT (the entire point of this feature):
 *   - Only say "nothing left this machine" when ALL AI sends for the matter
 *     were local-only (dataLeaves === false).
 *   - If any send was BYOK-direct ('direct' mode), say plainly: prompts for
 *     those calls went to the user's own AI provider under their own key.
 *     No Lantern content server was in the path. No training by Lantern.
 *     That provider did see the prompt.
 *   - If any send was 'assured', say it went through the firm's zero-retention
 *     proxy.
 *   - If mixed modes, list each honestly.
 *   - Never claim SOC 2 or signed DPA (they don't exist). Frame as
 *     architecture + BYOK + audit.
 */

import type { AuditEntry, AuditScope } from '@/platform/types/audit';
import type { ConfidentialityMode } from '@/platform/privacy/egress';
import { brandText } from '@/config/brandText';
import { BRAND } from '@/config/brand';

export interface ConfidentialityReportCall {
  at: string;           // ISO timestamp
  model: string;
  provider: string;
  mode: ConfidentialityMode;
  destination: string;
  dataLeaves: boolean;
}

export interface ConfidentialityReport {
  matterId: string | null;
  matterName: string;
  generatedAt: string;      // ISO timestamp passed in (never Date.now() here)
  totalCalls: number;
  byMode: Record<string, number>;   // e.g. { 'local-only': 3, 'direct': 1 }
  anyDataLeftMachine: boolean;
  allUnderOwnKeyOrLocal: boolean;
  calls: ConfidentialityReportCall[];
  /** The honest attestation sentence selected by the mode mix. */
  attestation: string;
}

/**
 * Pick the honest attestation text based on the mode mix.
 *
 * HONESTY RULES (the critical constraint):
 *  - all local-only: "Every AI call for this matter ran on a local model on
 *    your machine. Nothing left this machine. No third party saw this matter's
 *    data."
 *  - any direct (BYOK): "The AI calls for this matter went directly from your
 *    machine to your AI provider under your own API key. Lantern was not in
 *    the path and has no copy of these prompts. Your provider received the
 *    prompts and may retain them briefly per their data policy. No Lantern
 *    content server was involved, and Lantern does not use your data for
 *    training."
 *  - any assured (and no direct): "The AI calls for this matter were routed
 *    through your firm's zero-retention proxy. Lantern retained no prompt or
 *    completion. Your AI provider received the prompts under your firm's
 *    agreement with them."
 *  - mixed (direct + local, or direct + assured, etc): describe each mode
 *    honestly.
 *  - zero calls: "No AI activity was recorded for this matter."
 */
export function pickAttestation(byMode: Record<string, number>): string {
  const modes = Object.keys(byMode) as ConfidentialityMode[];
  const total = modes.reduce((s, m) => s + (byMode[m] ?? 0), 0);

  if (total === 0) {
    return 'No AI activity was recorded for this client.';
  }

  const localCount = byMode['local-only'] ?? 0;
  const directCount = byMode['direct'] ?? 0;
  const assuredCount = byMode['assured'] ?? 0;
  const hasLocal = localCount > 0;
  const hasDirect = directCount > 0;
  const hasAssured = assuredCount > 0;

  // Plural helper keeps the call-count copy grammatical without inlining the
  // ternary into every template literal.
  const calls = (n: number) => `${String(n)} call${n === 1 ? '' : 's'}`;

  if (hasLocal && !hasDirect && !hasAssured) {
    return (
      'Every AI call for this client ran on a local model on your machine. ' +
      'Nothing left this machine. No third party saw this client\'s data.'
    );
  }

  if (hasDirect && !hasAssured) {
    const parts: string[] = [];
    if (hasLocal) {
      parts.push(
        `${calls(localCount)} ran on a local model on your machine (nothing left the device).`
      );
    }
    parts.push(
      `${calls(directCount)} went directly from your machine to your AI provider under your own API key. ` +
      brandText(`${BRAND.name} was not in the path and has no copy of these prompts. `) +
      'Your provider received the prompts and may retain them briefly per their data policy. ' +
      brandText(`${BRAND.name} does not use your data for training.`)
    );
    return parts.join(' ');
  }

  if (hasAssured && !hasDirect) {
    const parts: string[] = [];
    if (hasLocal) {
      parts.push(
        `${calls(localCount)} ran on a local model on your machine (nothing left the device).`
      );
    }
    parts.push(
      `${calls(assuredCount)} were routed through your firm's zero-retention proxy. ` +
      brandText(`${BRAND.name} retained no prompt or completion. `) +
      'Your AI provider received the prompts under your firm\'s agreement with them.'
    );
    return parts.join(' ');
  }

  // Mixed: both direct and assured (and possibly local).
  const parts: string[] = [];
  if (hasLocal) {
    parts.push(
      `${calls(localCount)} ran on a local model (nothing left the device).`
    );
  }
  if (hasDirect) {
    parts.push(
      brandText(`${calls(directCount)} went directly from your machine to your AI provider under your own key (${BRAND.name} not in the path).`)
    );
  }
  if (hasAssured) {
    parts.push(
      brandText(`${calls(assuredCount)} went through your firm's zero-retention proxy (${BRAND.name} retained nothing).`)
    );
  }
  return parts.join(' ');
}

export function buildConfidentialityReport(
  entries: AuditEntry[],
  opts: { matterId: string | null; matterName: string; generatedAt: string }
): ConfidentialityReport {
  const { matterId, matterName, generatedAt } = opts;

  // Filter to egress events for this matter. An egress event from Task 1
  // carries scope in metadata.scope. For backward compat (pre-Task-1 entries
  // without scope), we fall back to including all egress entries when no scope
  // is available (i.e., legacy entries with no scope are attributed to any matter query).
  const egressEntries = entries.filter((e) => {
    if (e.action !== 'egress') return false;
    const meta = e.metadata;
    const scope = meta['scope'] as AuditScope | undefined;
    if (!scope) {
      // Legacy entry — no scope info. Include in an "all matters" report,
      // exclude from a specific-matter report.
      return matterId === null;
    }
    if (matterId === null) {
      // All-matters scope: include every egress entry.
      return true;
    }
    // Matter-specific: match by scope.matterId.
    return scope.kind === 'matter' && scope.matterId === matterId;
  });

  const calls: ConfidentialityReportCall[] = egressEntries.map((e) => {
    const meta = e.metadata;
    return {
      at: e.timestamp,
      model: e.model ?? (meta['model'] as string | undefined) ?? 'unknown',
      provider: (meta['provider'] as string | undefined) ?? 'unknown',
      mode: (meta['mode'] as ConfidentialityMode | undefined) ?? 'direct',
      destination: (meta['destination'] as string | undefined) ?? 'unknown',
      dataLeaves: (meta['dataLeaves'] as boolean | undefined) ?? true,
    };
  });

  const byMode: Record<string, number> = {};
  for (const call of calls) {
    byMode[call.mode] = (byMode[call.mode] ?? 0) + 1;
  }

  const anyDataLeftMachine = calls.some((c) => c.dataLeaves);
  const allUnderOwnKeyOrLocal = calls.every(
    (c) => !c.dataLeaves || c.destination === 'provider-direct'
  );

  return {
    matterId,
    matterName,
    generatedAt,
    totalCalls: calls.length,
    byMode,
    anyDataLeftMachine,
    allUnderOwnKeyOrLocal,
    calls,
    attestation: pickAttestation(byMode),
  };
}
