import { describe, it, expect } from 'vitest';
import { CHECKLIST, findCheck } from '../checklist.mjs';
import { STATUS, makeResult, summarize } from '../result.mjs';
import {
  groupChecksForSharding,
  splitChecksAcrossTargets,
  mergeShardSummaries,
  aggregateShardExitCode,
} from '../shard.mjs';

const TARGETS = [{ id: 'legion' }, { id: 'azure-cloud-bench-1' }];

describe('groupChecksForSharding', () => {
  it('keeps checks with the same sameTargetGroup together in checklist order', () => {
    const checks = [
      findCheck('workspace-binding'),
      findCheck('wave2-wealthbox-queue-review'),
      findCheck('index-health'),
      findCheck('wave2-wealthbox-approve-live'),
    ];

    expect(groupChecksForSharding(checks)).toEqual([
      { key: 'workspace-binding', checkIds: ['workspace-binding'] },
      { key: 'wave2-wealthbox', checkIds: ['wave2-wealthbox-queue-review', 'wave2-wealthbox-approve-live'] },
      { key: 'index-health', checkIds: ['index-health'] },
    ]);
  });
});

describe('splitChecksAcrossTargets', () => {
  it('round-robins check groups across targets', () => {
    const checks = [
      findCheck('workspace-binding'),
      findCheck('per-client-files-visible'),
      findCheck('index-health'),
      findCheck('wave0-draft-followup'),
    ];

    expect(splitChecksAcrossTargets(checks, TARGETS)).toEqual([
      { index: 0, target: TARGETS[0], checkIds: ['workspace-binding', 'index-health'] },
      { index: 1, target: TARGETS[1], checkIds: ['per-client-files-visible', 'wave0-draft-followup'] },
    ]);
  });

  it('keeps the live follow-up check on the same shard as its setup action', () => {
    const checks = CHECKLIST.filter((check) => check.id.startsWith('wave2-wealthbox'));
    const shards = splitChecksAcrossTargets(checks, TARGETS);
    expect(shards[0].checkIds).toEqual(['wave2-wealthbox-queue-review', 'wave2-wealthbox-approve-live']);
    expect(shards[1].checkIds).toEqual([]);
  });

  it('rejects an empty target list', () => {
    expect(() => splitChecksAcrossTargets([findCheck('workspace-binding')], [])).toThrow(/at least one target/);
  });
});

describe('mergeShardSummaries', () => {
  it('merges results back into requested checklist order and preserves exit-code semantics', () => {
    const shardA = summarize(
      [
        makeResult({ id: 'index-health', section: 'S', status: STATUS.PASS, detail: 'ok' }),
        makeResult({ id: 'workspace-binding', section: 'S', status: STATUS.PASS, detail: 'ok' }),
      ],
      { target: 'legion' }
    );
    const shardB = summarize(
      [makeResult({ id: 'per-client-files-visible', section: 'S', status: STATUS.SETUP_BLOCKED, detail: 'blocked' })],
      { target: 'azure-cloud-bench-1' }
    );

    const combined = mergeShardSummaries([shardA, shardB], {
      generatedAt: '2026-07-04T00:00:00.000Z',
      orderedIds: ['workspace-binding', 'per-client-files-visible', 'index-health'],
    });

    expect(combined.results.map((result) => result.id)).toEqual([
      'workspace-binding',
      'per-client-files-visible',
      'index-health',
    ]);
    expect(combined.overall).toBe('SETUP-BLOCKED');
    expect(aggregateShardExitCode(combined)).toBe(3);
    expect(combined.shards).toMatchObject([
      { target: 'legion', overall: 'PASS' },
      { target: 'azure-cloud-bench-1', overall: 'SETUP-BLOCKED' },
    ]);
  });

  it('FAIL outranks setup-blocked in the combined exit code', () => {
    const combined = mergeShardSummaries([
      summarize([makeResult({ id: 'a', section: 'S', status: STATUS.SETUP_BLOCKED, detail: 'blocked' })]),
      summarize([makeResult({ id: 'b', section: 'S', status: STATUS.FAIL, detail: 'broke' })]),
    ]);

    expect(combined.overall).toBe('FAIL');
    expect(aggregateShardExitCode(combined)).toBe(1);
  });
});
