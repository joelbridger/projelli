import type { TeamActivityItem } from '@/features/crm-activity/team-feed';

export type ActivityFilterKind = 'all' | 'mentions' | 'discussions' | 'reactions';

export interface ActivityFilterSearchState {
  readonly [key: string]: string;
  readonly query: string;
  readonly kind: ActivityFilterKind;
  readonly authorId: string;
}

export const defaultActivityFilterSearchState: ActivityFilterSearchState = {
  query: '',
  kind: 'all',
  authorId: '',
};

const filterKinds = new Set<ActivityFilterKind>([
  'all',
  'mentions',
  'discussions',
  'reactions',
]);

export function activityFilterSearchState(
  value: ActivityFilterSearchState | undefined,
): ActivityFilterSearchState {
  if (!value) return defaultActivityFilterSearchState;
  return {
    query: value.query,
    kind: filterKinds.has(value.kind) ? value.kind : 'all',
    authorId: value.authorId,
  };
}

function searchableText(item: TeamActivityItem): string {
  return [
    item.body,
    item.author.displayName,
    item.author.memberId,
    ...item.mentionedMemberIds,
    ...item.comments.flatMap((comment) => [
      comment.body,
      comment.author.displayName,
      comment.author.memberId,
    ]),
  ].join(' ').toLocaleLowerCase();
}

function matchesKind(item: TeamActivityItem, kind: ActivityFilterKind): boolean {
  switch (kind) {
    case 'all': return true;
    case 'mentions': return item.mentionedMemberIds.length > 0;
    case 'discussions': return item.comments.length > 0;
    case 'reactions': return item.reactions.length > 0;
  }
}

/** A pure display selector; source order is retained by the registry projection. */
export function matchesActivityFilterSearch(
  item: TeamActivityItem,
  state: ActivityFilterSearchState,
): boolean {
  const query = state.query.trim().toLocaleLowerCase();
  return matchesKind(item, state.kind)
    && (!state.authorId || item.author.memberId === state.authorId)
    && (!query || searchableText(item).includes(query));
}

export function activityAuthors(items: readonly TeamActivityItem[]): readonly {
  readonly id: string;
  readonly label: string;
}[] {
  const authors = new Map<string, string>();
  for (const item of items) authors.set(item.author.memberId, item.author.displayName);
  return [...authors.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}
