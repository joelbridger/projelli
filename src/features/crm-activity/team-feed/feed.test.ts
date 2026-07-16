import { describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  TEAM_ACTIVITY_FIRM_SCOPE,
  TEAM_ACTIVITY_STAGED_TRUST,
  type TeamActivityDeferredAuthority,
  type TeamActivityMutationAuthor,
  type TeamActivityPost,
} from './contracts';
import { createTeamActivityFeed, type TeamActivityStore } from './feed';

const authority: TeamActivityDeferredAuthority = {
  identityTrust: TEAM_ACTIVITY_STAGED_TRUST,
  roleBinding: 'deferred',
  operationBinding: 'deferred',
};
const maya: TeamActivityMutationAuthor = {
  memberId: 'maya',
  displayName: 'Maya',
  trust: TEAM_ACTIVITY_STAGED_TRUST,
};

function memoryStore(initial: readonly LiveCrmRecord[] = []) {
  let records = [...initial];
  const listeners = new Set<() => void>();
  const audit = vi.fn().mockResolvedValue(undefined);
  const save = <T extends LiveCrmRecord>(record: T): Promise<T> => {
    records = [...records.filter((item) => item.id !== record.id), record];
    listeners.forEach((listener) => { listener(); });
    return Promise.resolve(record);
  };
  const store: TeamActivityStore = {
    load: (matterId) => Promise.resolve(records.filter((record) => record.matterId === matterId)),
    createPost: (input) => {
      const createdAt = '2026-07-16T10:00:00.000Z';
      return save({
        ...input,
        mentionedMemberIds: input.mentionedMemberIds ?? [],
        kind: 'teamActivityPost', authority, createdAt, updatedAt: createdAt,
      });
    },
    addComment: (input) => {
      const createdAt = '2026-07-16T10:01:00.000Z';
      return save({ ...input, kind: 'teamActivityComment', authority, createdAt, updatedAt: createdAt });
    },
    setReaction: (input) => {
      const createdAt = '2026-07-16T10:02:00.000Z';
      return save({ ...input, kind: 'teamActivityReaction', authority, createdAt, updatedAt: createdAt });
    },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    audit,
  };
  return { store, records: () => records, audit };
}

describe('team activity feed contract', () => {
  it('persists a staged post, comment, and reaction across a save then reload', async () => {
    const memory = memoryStore();
    const feed = createTeamActivityFeed(memory.store);
    const post = await feed.createPost({ body: 'Annual review is ready.', author: maya, mentionedMemberIds: ['oliver'] });
    await feed.addComment({ postId: post.id, body: 'I will send the packet.', author: { ...maya, memberId: 'oliver', displayName: 'Oliver' } });
    await feed.setReaction({ postId: post.id, emoji: '👍', memberId: 'oliver', authorshipTrust: TEAM_ACTIVITY_STAGED_TRUST, active: true });

    const reloaded = createTeamActivityFeed(memory.store);
    const items = await reloaded.query();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ body: 'Annual review is ready.', mentionedMemberIds: ['oliver'] });
    expect(items[0]?.comments).toHaveLength(1);
    expect(items[0]?.reactions).toHaveLength(1);
    expect(memory.audit).toHaveBeenCalledTimes(3);
    expect(memory.records().every((record) => record.matterId === TEAM_ACTIVITY_FIRM_SCOPE)).toBe(true);
  });

  it('reads only the bound firm scope and ignores malformed records safely', async () => {
    const valid: TeamActivityPost = {
      id: 'team-activity-post:firm', kind: 'teamActivityPost', matterId: TEAM_ACTIVITY_FIRM_SCOPE,
      body: 'Firm update', author: maya, mentionedMemberIds: [], authority,
      createdAt: '2026-07-16T10:00:00.000Z', updatedAt: '2026-07-16T10:00:00.000Z',
    };
    const memory = memoryStore([
      valid,
      { ...valid, id: 'team-activity-post:other', matterId: 'other-firm', body: 'Other firm' },
      { id: 'team-activity-post:malformed', kind: 'teamActivityPost', matterId: TEAM_ACTIVITY_FIRM_SCOPE, body: 'Missing author' },
    ]);
    await expect(createTeamActivityFeed(memory.store).query()).resolves.toMatchObject([{ body: 'Firm update' }]);
  });

  it('rejects missing parents in the same scope before audit or native save', async () => {
    const memory = memoryStore();
    await expect(createTeamActivityFeed(memory.store).addComment({
      postId: 'team-activity-post:missing', body: 'Orphan', author: maya,
    })).rejects.toThrow('does not exist in this firm scope');
    expect(memory.audit).not.toHaveBeenCalled();
    expect(memory.records()).toEqual([]);
  });

  it('fails closed when required durable audit is unavailable', async () => {
    const memory = memoryStore();
    memory.audit.mockRejectedValue(new Error('audit unavailable'));
    await expect(createTeamActivityFeed(memory.store).createPost({
      body: 'Must not persist', author: maya,
    })).rejects.toThrow('audit unavailable');
    expect(memory.records()).toEqual([]);
    expect(memory.audit.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      operation: 'post', state: 'requested', mentionCount: 0,
    }));
    expect(JSON.stringify(memory.audit.mock.calls[0]?.[0])).not.toContain('Must not persist');
    expect(JSON.stringify(memory.audit.mock.calls[0]?.[0])).not.toContain('Maya');
  });
});
