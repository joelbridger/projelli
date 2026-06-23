/**
 * carryMattersToFirm — the bulk solo-to-firm carry-over routine.
 *
 * Given the user's per-matter choice (private vs share), this runs the proven
 * single-matter promote routine across the share selections and leaves the
 * private ones exactly as they are. It is a THIN wrapper around
 * promoteMatterToShared: no firm-matter creation or key publishing is
 * re-implemented here.
 */
import { promoteMatterToShared } from '@/features/matters/logic/promoteMatterToShared';
import type { FirmApiClient } from '@/platform/firm/FirmApiClient';

export type CarrySelection = { matterId: string; clientName: string; action: 'private' | 'share' };
export type CarryMatterOutcome =
  | { matterId: string; status: 'kept-private' }
  | { matterId: string; status: 'shared'; firmMatterId: string }
  | { matterId: string; status: 'failed'; error: string };

/**
 * Carry a set of local matters into the firm per the user's per-matter choice.
 * 'private' matters are left exactly as-is. 'share' matters run the proven
 * promote routine, SEQUENTIALLY (never in parallel) to avoid hammering the relay
 * and keychain. One matter failing never aborts the others.
 */
export async function carryMattersToFirm(
  selections: CarrySelection[],
  client: FirmApiClient,
  onProgress?: (done: number, total: number) => void,
): Promise<CarryMatterOutcome[]> {
  const outcomes: CarryMatterOutcome[] = selections
    .filter((s) => s.action === 'private')
    .map((s) => ({ matterId: s.matterId, status: 'kept-private' as const }));

  const toShare = selections.filter((s) => s.action === 'share');
  let done = 0;
  for (const s of toShare) {
    try {
      const r = await promoteMatterToShared(s.matterId, s.clientName, client);
      outcomes.push(
        r.status === 'shared'
          ? { matterId: s.matterId, status: 'shared', firmMatterId: r.firmMatterId }
          : { matterId: s.matterId, status: 'failed', error: r.error },
      );
    } catch (err) {
      // Defense in depth: promoteMatterToShared returns a 'failed' result rather
      // than throwing, but if it ever does throw we still isolate that one
      // matter and keep carrying the rest over.
      outcomes.push({
        matterId: s.matterId,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      done += 1;
      onProgress?.(done, toShare.length);
    }
  }
  return outcomes;
}
