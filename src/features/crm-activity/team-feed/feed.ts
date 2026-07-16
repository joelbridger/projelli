import {
  filterOwnClientRecords,
  ownClientsEnforcementActive,
} from '@/features/crm-permissions';
import {
  resolveMemberAccess,
  roleForMember,
  SYSTEM_ROLE_PERMISSIONS,
} from '@/features/crm-firm/teams-roles';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type {
  AddTeamActivityComment,
  CreateTeamActivityPost,
  SetTeamActivityReaction,
  TeamActivityComment,
  TeamActivityFeed,
  TeamActivityItem,
  TeamActivityPost,
  TeamActivityQuery,
  TeamActivityReaction,
} from './contracts';

export interface TeamActivityStore {
  load(): Promise<readonly LiveCrmRecord[]>;
  save(record: LiveCrmRecord): Promise<LiveCrmRecord>;
  subscribe(listener: () => void): () => void;
  audit?(event: { action: 'user_action'; activityId: string; operation: 'post' | 'comment' | 'reaction'; mentionCount?: number }): Promise<void>;
}

function isPost(record: LiveCrmRecord): record is TeamActivityPost {
  return record.kind === 'teamActivityPost' && typeof record['body'] === 'string' && typeof record['createdAt'] === 'string';
}

function isComment(record: LiveCrmRecord): record is TeamActivityComment {
  return record.kind === 'teamActivityComment' && typeof record['postId'] === 'string' && typeof record['body'] === 'string' && typeof record['createdAt'] === 'string';
}

function isReaction(record: LiveCrmRecord): record is TeamActivityReaction {
  return record.kind === 'teamActivityReaction' && typeof record['postId'] === 'string' && typeof record['emoji'] === 'string' && typeof record['memberId'] === 'string' && typeof record['createdAt'] === 'string' && typeof record['active'] === 'boolean';
}

function safeId(value: string): string {
  return Array.from(value).map((character) => /[a-zA-Z0-9_-]/.test(character) ? character : character.codePointAt(0)?.toString(16) ?? 'x').join('_');
}

function now(): string { return new Date().toISOString(); }

/** The current display mirror, kept separate so its no-op and fail-closed cases are testable. */
export async function filterTeamActivityRecords(records: readonly LiveCrmRecord[], query: TeamActivityQuery): Promise<readonly LiveCrmRecord[]> {
  const role = roleForMember(SYSTEM_ROLE_PERMISSIONS, query.memberships, query.memberId);
  // Keep this public doorway call even though the resolved access is currently
  // renderer supplied and untrusted. Native enforcement will bind it later.
  resolveMemberAccess(SYSTEM_ROLE_PERMISSIONS, query.memberships, query.memberId);
  const enforcementActive = await ownClientsEnforcementActive();
  return filterOwnClientRecords(records, { memberId: query.memberId, role, operation: query.operation }, enforcementActive);
}

function toItems(records: readonly LiveCrmRecord[]): readonly TeamActivityItem[] {
  const comments = records.filter(isComment);
  const reactions = records.filter(isReaction).filter((reaction) => reaction.active);
  return records.filter(isPost).map((post) => ({
    id: post.id,
    body: post.body,
    author: post.author,
    mentionedMemberIds: post.mentionedMemberIds,
    createdAt: post.createdAt,
    comments: comments.filter((comment) => comment.postId === post.id).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    reactions: reactions.filter((reaction) => reaction.postId === post.id),
  })).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function createTeamActivityFeed(store: TeamActivityStore): TeamActivityFeed {
  return {
    async query(query) {
      return toItems(await filterTeamActivityRecords(await store.load(), query));
    },
    subscribe(listener) { return store.subscribe(listener); },
    async createPost(input: CreateTeamActivityPost) {
      const createdAt = now();
      const post: TeamActivityPost = {
        id: `team-activity-post:${crypto.randomUUID()}`,
        kind: 'teamActivityPost',
        matterId: 'firm_home',
        body: input.body.trim(),
        author: input.author,
        mentionedMemberIds: input.mentionedMemberIds ?? [],
        createdAt,
        updatedAt: createdAt,
      };
      await store.save(post);
      await store.audit?.({ action: 'user_action', activityId: post.id, operation: 'post', mentionCount: post.mentionedMemberIds.length });
      return post;
    },
    async addComment(input: AddTeamActivityComment) {
      const createdAt = now();
      const comment: TeamActivityComment = {
        id: `team-activity-comment:${crypto.randomUUID()}`,
        kind: 'teamActivityComment',
        matterId: 'firm_home',
        postId: input.postId,
        body: input.body.trim(),
        author: input.author,
        createdAt,
        updatedAt: createdAt,
      };
      await store.save(comment);
      await store.audit?.({ action: 'user_action', activityId: comment.id, operation: 'comment' });
      return comment;
    },
    async setReaction(input: SetTeamActivityReaction) {
      const createdAt = now();
      const reaction: TeamActivityReaction = {
        id: `team-activity-reaction:${safeId(input.postId)}:${safeId(input.emoji)}:${safeId(input.memberId)}`,
        kind: 'teamActivityReaction',
        matterId: 'firm_home',
        postId: input.postId,
        emoji: input.emoji,
        memberId: input.memberId,
        active: input.active,
        createdAt,
        updatedAt: createdAt,
      };
      await store.save(reaction);
      await store.audit?.({ action: 'user_action', activityId: reaction.id, operation: 'reaction' });
      return reaction;
    },
  };
}
