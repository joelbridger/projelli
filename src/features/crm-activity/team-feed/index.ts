/**
 * Public activity-feed contract for consumers such as activity-filter-search.
 * It exposes only display items, async query/subscription, and approved writes;
 * storage, mention parsing, permission internals, and audit payloads are private.
 */
export { createTeamActivityFeed, filterTeamActivityRecords } from './feed';
export { teamActivitySurface } from './surface';
export type {
  AddTeamActivityComment,
  CreateTeamActivityPost,
  SetTeamActivityReaction,
  TeamActivityComment,
  TeamActivityFeed,
  TeamActivityItem,
  TeamActivityMutationAuthor,
  TeamActivityPost,
  TeamActivityQuery,
  TeamActivityReaction,
} from './contracts';
