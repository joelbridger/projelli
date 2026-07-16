import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

export const TEAM_ACTIVITY_FIRM_SCOPE = 'firm_home' as const;
export const TEAM_ACTIVITY_STAGED_TRUST = 'renderer-staged-untrusted' as const;

export interface TeamActivityDeferredAuthority {
  identityTrust: typeof TEAM_ACTIVITY_STAGED_TRUST;
  roleBinding: 'deferred';
  operationBinding: 'deferred';
}

/** Display-only authorship. It is never a signed-in-member identity claim. */
export interface TeamActivityMutationAuthor {
  memberId: string;
  displayName: string;
  trust: typeof TEAM_ACTIVITY_STAGED_TRUST;
}

export interface TeamActivityPost extends LiveCrmRecord {
  kind: 'teamActivityPost';
  matterId: typeof TEAM_ACTIVITY_FIRM_SCOPE;
  body: string;
  author: TeamActivityMutationAuthor;
  mentionedMemberIds: readonly string[];
  authority: TeamActivityDeferredAuthority;
  createdAt: string;
  updatedAt: string;
}

export interface TeamActivityComment extends LiveCrmRecord {
  kind: 'teamActivityComment';
  matterId: typeof TEAM_ACTIVITY_FIRM_SCOPE;
  postId: string;
  body: string;
  author: TeamActivityMutationAuthor;
  authority: TeamActivityDeferredAuthority;
  createdAt: string;
  updatedAt: string;
}

export interface TeamActivityReaction extends LiveCrmRecord {
  kind: 'teamActivityReaction';
  matterId: typeof TEAM_ACTIVITY_FIRM_SCOPE;
  postId: string;
  emoji: '👍' | '❤️';
  memberId: string;
  authorshipTrust: typeof TEAM_ACTIVITY_STAGED_TRUST;
  authority: TeamActivityDeferredAuthority;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

export type TeamActivityRecord =
  | TeamActivityPost
  | TeamActivityComment
  | TeamActivityReaction;

export interface TeamActivityItem {
  id: string;
  body: string;
  author: TeamActivityMutationAuthor;
  mentionedMemberIds: readonly string[];
  createdAt: string;
  comments: readonly TeamActivityComment[];
  reactions: readonly TeamActivityReaction[];
}

export interface CreateTeamActivityPost {
  body: string;
  author: TeamActivityMutationAuthor;
  mentionedMemberIds?: readonly string[];
}

export interface AddTeamActivityComment {
  postId: string;
  body: string;
  author: TeamActivityMutationAuthor;
}

export interface SetTeamActivityReaction {
  postId: string;
  emoji: '👍' | '❤️';
  memberId: string;
  authorshipTrust: typeof TEAM_ACTIVITY_STAGED_TRUST;
  active: boolean;
}

/** Consumer-shaped feed already bound to one canonical firm scope. */
export interface TeamActivityFeed {
  query(): Promise<readonly TeamActivityItem[]>;
  subscribe(listener: () => void): () => void;
  createPost(input: CreateTeamActivityPost): Promise<TeamActivityPost>;
  addComment(input: AddTeamActivityComment): Promise<TeamActivityComment>;
  setReaction(input: SetTeamActivityReaction): Promise<TeamActivityReaction>;
}
