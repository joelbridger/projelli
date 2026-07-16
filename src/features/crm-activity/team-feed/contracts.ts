import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { MemberAssignment } from '@/features/crm-firm/teams-roles';
import type { OwnClientsContext, PermissionOperation } from '@/features/crm-permissions';

/** Safe display data consumed by the activity screen and its later filter tool. */
export interface TeamActivityPost extends LiveCrmRecord {
  kind: 'teamActivityPost';
  body: string;
  author: { memberId: string; displayName: string };
  mentionedMemberIds: readonly string[];
  createdAt: string;
}

export interface TeamActivityComment extends LiveCrmRecord {
  kind: 'teamActivityComment';
  postId: string;
  body: string;
  author: { memberId: string; displayName: string };
  createdAt: string;
}

export interface TeamActivityReaction extends LiveCrmRecord {
  kind: 'teamActivityReaction';
  postId: string;
  emoji: string;
  memberId: string;
  createdAt: string;
  active: boolean;
}

export interface TeamActivityItem {
  id: string;
  body: string;
  author: { memberId: string; displayName: string };
  mentionedMemberIds: readonly string[];
  createdAt: string;
  comments: readonly TeamActivityComment[];
  reactions: readonly TeamActivityReaction[];
}

/**
 * Renderer-supplied display context. It is deliberately not an identity proof:
 * the future native enforcement layer must bind member, role, and operation.
 */
export interface TeamActivityQuery {
  memberId: string;
  operation: PermissionOperation;
  memberships: readonly MemberAssignment[];
}

export interface TeamActivityMutationAuthor {
  memberId: string;
  displayName: string;
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
  emoji: string;
  memberId: string;
  active: boolean;
}

export interface TeamActivityFeed {
  query(query: TeamActivityQuery): Promise<readonly TeamActivityItem[]>;
  subscribe(listener: () => void): () => void;
  createPost(input: CreateTeamActivityPost): Promise<TeamActivityPost>;
  addComment(input: AddTeamActivityComment): Promise<TeamActivityComment>;
  setReaction(input: SetTeamActivityReaction): Promise<TeamActivityReaction>;
}

export type TeamActivityPermissionContext = OwnClientsContext;
