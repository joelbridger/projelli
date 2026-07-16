import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  TEAM_ACTIVITY_FIRM_SCOPE,
  TEAM_ACTIVITY_STAGED_TRUST,
  type AddTeamActivityComment,
  type CreateTeamActivityPost,
  type SetTeamActivityReaction,
  type TeamActivityComment,
  type TeamActivityFeed,
  type TeamActivityItem,
  type TeamActivityPost,
  type TeamActivityReaction,
} from './contracts';

export interface TeamActivityAuditEvent {
  action: 'user_action';
  activityId: string;
  operation: 'post' | 'comment' | 'reaction';
  mentionCount: number;
  state: 'requested';
}

/** Private adapter implemented by the feature-owned native client. */
export interface TeamActivityStore {
  load(matterId: typeof TEAM_ACTIVITY_FIRM_SCOPE): Promise<readonly LiveCrmRecord[]>;
  createPost(input: NativeCreatePost): Promise<TeamActivityPost>;
  addComment(input: NativeAddComment): Promise<TeamActivityComment>;
  setReaction(input: NativeSetReaction): Promise<TeamActivityReaction>;
  subscribe(listener: () => void): () => void;
  audit(event: TeamActivityAuditEvent): Promise<void>;
}

interface NativeCreatePost extends CreateTeamActivityPost {
  id: string;
  matterId: typeof TEAM_ACTIVITY_FIRM_SCOPE;
}
interface NativeAddComment extends AddTeamActivityComment {
  id: string;
  matterId: typeof TEAM_ACTIVITY_FIRM_SCOPE;
}
interface NativeSetReaction extends SetTeamActivityReaction {
  id: string;
  matterId: typeof TEAM_ACTIVITY_FIRM_SCOPE;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAuthority(value: unknown): boolean {
  return isObject(value)
    && value['identityTrust'] === TEAM_ACTIVITY_STAGED_TRUST
    && value['roleBinding'] === 'deferred'
    && value['operationBinding'] === 'deferred';
}

function isAuthor(value: unknown): boolean {
  return isObject(value)
    && typeof value['memberId'] === 'string'
    && typeof value['displayName'] === 'string'
    && value['trust'] === TEAM_ACTIVITY_STAGED_TRUST;
}

function hasCanonicalScope(record: LiveCrmRecord): boolean {
  return record.matterId === TEAM_ACTIVITY_FIRM_SCOPE;
}

function isPost(record: LiveCrmRecord): record is TeamActivityPost {
  return hasCanonicalScope(record)
    && record.kind === 'teamActivityPost'
    && typeof record['body'] === 'string'
    && isAuthor(record['author'])
    && Array.isArray(record['mentionedMemberIds'])
    && record['mentionedMemberIds'].every((value) => typeof value === 'string')
    && isAuthority(record['authority'])
    && typeof record['createdAt'] === 'string'
    && typeof record['updatedAt'] === 'string';
}

function isComment(record: LiveCrmRecord): record is TeamActivityComment {
  return hasCanonicalScope(record)
    && record.kind === 'teamActivityComment'
    && typeof record['postId'] === 'string'
    && typeof record['body'] === 'string'
    && isAuthor(record['author'])
    && isAuthority(record['authority'])
    && typeof record['createdAt'] === 'string'
    && typeof record['updatedAt'] === 'string';
}

function isReaction(record: LiveCrmRecord): record is TeamActivityReaction {
  return hasCanonicalScope(record)
    && record.kind === 'teamActivityReaction'
    && typeof record['postId'] === 'string'
    && (record['emoji'] === '👍' || record['emoji'] === '❤️')
    && typeof record['memberId'] === 'string'
    && record['authorshipTrust'] === TEAM_ACTIVITY_STAGED_TRUST
    && isAuthority(record['authority'])
    && typeof record['createdAt'] === 'string'
    && typeof record['updatedAt'] === 'string'
    && typeof record['active'] === 'boolean';
}

function safeId(value: string): string {
  return Array.from(value).map((character) =>
    /[a-zA-Z0-9_-]/.test(character)
      ? character
      : character.codePointAt(0)?.toString(16) ?? 'x'
  ).join('_');
}

function toItems(records: readonly LiveCrmRecord[]): readonly TeamActivityItem[] {
  const posts = records.filter(isPost);
  const postIds = new Set(posts.map((post) => post.id));
  const comments = records.filter(isComment).filter((comment) => postIds.has(comment.postId));
  const reactions = records.filter(isReaction)
    .filter((reaction) => reaction.active && postIds.has(reaction.postId));
  return posts.map((post) => ({
    id: post.id,
    body: post.body,
    author: post.author,
    mentionedMemberIds: post.mentionedMemberIds,
    createdAt: post.createdAt,
    comments: comments.filter((comment) => comment.postId === post.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    reactions: reactions.filter((reaction) => reaction.postId === post.id),
  })).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function requireParent(store: TeamActivityStore, postId: string): Promise<void> {
  const records = await store.load(TEAM_ACTIVITY_FIRM_SCOPE);
  if (!records.some((record) => isPost(record) && record.id === postId)) {
    throw new Error('Team activity parent post does not exist in this firm scope.');
  }
}

/**
 * Every mutation audits the truthful request before native persistence. Audit
 * failure therefore leaves no activity row. A later native failure may leave
 * a truthful “requested” audit entry, never a false completion claim.
 */
export function createTeamActivityFeed(store: TeamActivityStore): TeamActivityFeed {
  return {
    async query() {
      return toItems(await store.load(TEAM_ACTIVITY_FIRM_SCOPE));
    },
    subscribe(listener) { return store.subscribe(listener); },
    async createPost(input: CreateTeamActivityPost) {
      const id = `team-activity-post:${crypto.randomUUID()}`;
      await store.audit({
        action: 'user_action', activityId: id, operation: 'post',
        mentionCount: input.mentionedMemberIds?.length ?? 0, state: 'requested',
      });
      return store.createPost({ ...input, id, matterId: TEAM_ACTIVITY_FIRM_SCOPE });
    },
    async addComment(input: AddTeamActivityComment) {
      await requireParent(store, input.postId);
      const id = `team-activity-comment:${crypto.randomUUID()}`;
      await store.audit({
        action: 'user_action', activityId: id, operation: 'comment', mentionCount: 0, state: 'requested',
      });
      return store.addComment({ ...input, id, matterId: TEAM_ACTIVITY_FIRM_SCOPE });
    },
    async setReaction(input: SetTeamActivityReaction) {
      await requireParent(store, input.postId);
      const id = `team-activity-reaction:${safeId(input.postId)}:${safeId(input.emoji)}:${safeId(input.memberId)}`;
      await store.audit({
        action: 'user_action', activityId: id, operation: 'reaction', mentionCount: 0, state: 'requested',
      });
      return store.setReaction({ ...input, id, matterId: TEAM_ACTIVITY_FIRM_SCOPE });
    },
  };
}
