// Pure shard helpers for scripts/bench-smoke-shard.mjs. These functions do no
// SSH, no subprocess work, and no filesystem writes, so Vitest can cover the
// important split/merge behavior without touching a real bench.
import { aggregateExitCode, summarize } from './result.mjs';

export function groupChecksForSharding(checks) {
  const consumed = new Set();
  const groups = [];

  for (const check of checks) {
    if (!check?.id || consumed.has(check.id)) continue;
    const groupKey = check.sameTargetGroup || check.id;
    const members = checks.filter((candidate) => (candidate.sameTargetGroup || candidate.id) === groupKey);
    for (const member of members) consumed.add(member.id);
    groups.push({ key: groupKey, checkIds: members.map((member) => member.id) });
  }

  return groups;
}

export function splitChecksAcrossTargets(checks, targets) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error('splitChecksAcrossTargets requires at least one target');
  }

  const shards = targets.map((target, index) => ({ index, target, checkIds: [] }));
  const groups = groupChecksForSharding(checks);

  groups.forEach((group, index) => {
    shards[index % shards.length].checkIds.push(...group.checkIds);
  });

  return shards;
}

export function mergeShardSummaries(summaries, { generatedAt = null, live = false, orderedIds = [] } = {}) {
  const rank = new Map(orderedIds.map((id, index) => [id, index]));
  const results = summaries
    .flatMap((summary) => summary.results ?? [])
    .sort((a, b) => {
      const ar = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
      const br = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
      if (ar !== br) return ar - br;
      return String(a.id).localeCompare(String(b.id));
    });

  return {
    ...summarize(results, { generatedAt, target: 'sharded', live }),
    shards: summaries.map((summary) => ({
      target: summary.target ?? null,
      overall: summary.overall ?? null,
      counts: summary.counts ?? null,
    })),
  };
}

export function aggregateShardExitCode(summary) {
  return aggregateExitCode(summary.results ?? []);
}
