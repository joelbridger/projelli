import { describe, expect, it, vi } from 'vitest';
import { filterOwnClientRecords } from '@/features/crm-permissions';
import { createTeamActivityFeed } from './feed';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

function memoryStore(initial: readonly LiveCrmRecord[] = []) {
  let records = [...initial];
  const listeners = new Set<() => void>();
  const audit = vi.fn().mockResolvedValue(undefined);
  return {
    store: {
      load: () => Promise.resolve(records),
      save: (record: LiveCrmRecord) => { records = [...records.filter((item) => item.id !== record.id), record]; listeners.forEach((listener) => { listener(); }); return Promise.resolve(record); },
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      audit,
    },
    records: () => records,
    audit,
  };
}

describe('team activity feed public contract', () => {
  it('persists a post, comment, and reaction across a save then reload', async () => {
    const memory = memoryStore();
    const feed = createTeamActivityFeed(memory.store);
    const post = await feed.createPost({ body: 'Annual review is ready.', author: { memberId: 'maya', displayName: 'Maya' }, mentionedMemberIds: ['oliver'] });
    await feed.addComment({ postId: post.id, body: 'I will send the packet.', author: { memberId: 'oliver', displayName: 'Oliver' } });
    await feed.setReaction({ postId: post.id, emoji: '👍', memberId: 'oliver', active: true });

    const reloaded = createTeamActivityFeed(memory.store);
    const items = await reloaded.query({ memberId: 'maya', operation: 'read', memberships: [{ memberId: 'maya', roleId: 'advisor', teamIds: [] }] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ body: 'Annual review is ready.', mentionedMemberIds: ['oliver'] });
    expect(items[0]?.comments).toHaveLength(1);
    expect(items[0]?.reactions).toHaveLength(1);
    expect(memory.audit).toHaveBeenCalledTimes(3);
    expect(memory.records().some((record) => record.kind === 'teamActivityPost')).toBe(true);
  });

  it('does not create a phantom item or audit action after a failed save', async () => {
    const failing = {
      load: () => Promise.resolve([] as readonly LiveCrmRecord[]),
      save: vi.fn().mockRejectedValue(new Error('disk unavailable')),
      subscribe: () => () => undefined,
      audit: vi.fn(),
    };
    const feed = createTeamActivityFeed(failing);
    await expect(feed.createPost({ body: 'Do not appear', author: { memberId: 'maya', displayName: 'Maya' } })).rejects.toThrow('disk unavailable');
    await expect(feed.query({ memberId: 'maya', operation: 'read', memberships: [] })).resolves.toEqual([]);
    expect(failing.audit).not.toHaveBeenCalled();
  });

  it('keeps the currently inactive mirror as a no-op and proves the synthetic active policy fails closed without durable labels', () => {
    const records: LiveCrmRecord[] = [{ id: 'post-1', kind: 'teamActivityPost', body: 'Private update', createdAt: '2026-07-16T10:00:00.000Z' }];
    const context = { memberId: 'maya', role: { id: 'advisor' as const, clientAccess: 'assigned' as const, capabilities: ['clients:read'] as const }, operation: 'read' as const };
    expect(filterOwnClientRecords(records, context, false)).toEqual(records);
    expect(filterOwnClientRecords(records, context, true)).toEqual([]);
  });
});
