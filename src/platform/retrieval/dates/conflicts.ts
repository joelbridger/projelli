import type { RagHit } from '@/platform/utils/tauri-commands';
import type { DateConflictFlag, DatedEvidence } from './contracts';
import { normalizeSourceDate, sourceDateTimestamp } from './sourceDates';

type DatedHit = RagHit & { sourceDate: NonNullable<RagHit['sourceDate']> };

function stableSourceId(hit: RagHit): string {
  return hit.sourceId ?? hit.id ?? `${hit.path}#${hit.paragraphIndex}`;
}

function normalizedClaimPart(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function evidenceFromHit(hit: DatedHit): DatedEvidence {
  return {
    sourceId: stableSourceId(hit),
    path: hit.path,
    value: hit.datedFact!.value,
    sourceDate: hit.sourceDate,
    ...(hit.datedFact!.authorityReason ? { authorityReason: hit.datedFact!.authorityReason } : {}),
  };
}

/**
 * Adds conflict flags but intentionally retains retrieval order and every hit.
 * A conflict needs explicit same-fact metadata plus two different values with
 * real source dates; date difference alone is never treated as disagreement.
 */
export function flagDatedEvidenceConflicts(hits: RagHit[]): RagHit[] {
  const normalizedHits = hits.map((hit) => ({
    ...hit,
    sourceDate: normalizeSourceDate(hit.sourceDate),
  }));

  const groups = new Map<string, DatedHit[]>();
  for (const hit of normalizedHits) {
    if (!hit.datedFact || sourceDateTimestamp(hit.sourceDate) == null) continue;
    const key = normalizedClaimPart(hit.datedFact.key);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(hit);
    groups.set(key, group);
  }

  const conflictsBySource = new Map<string, DateConflictFlag>();
  for (const [factKey, group] of groups) {
    if (new Set(group.map((hit) => normalizedClaimPart(hit.datedFact!.value))).size < 2) continue;
    const evidence = group
      .slice()
      .sort((a, b) => sourceDateTimestamp(a.sourceDate)! - sourceDateTimestamp(b.sourceDate)!)
      .map(evidenceFromHit);

    const newest = evidence.at(-1);
    if (!newest) continue;
    for (const hit of group) {
      const sourceId = stableSourceId(hit);
      conflictsBySource.set(sourceId, {
        kind: 'conflicting-dated-evidence',
        factKey,
        relation: sourceId === newest.sourceId ? 'newer-conflicts-with-older' : 'older-conflicts-with-newer',
        evidence,
      });
    }
  }

  return normalizedHits.map((hit) => {
    const dateConflict = conflictsBySource.get(stableSourceId(hit));
    return dateConflict ? { ...hit, dateConflict } : hit;
  });
}
