/**
 * Public activity-feed contract. Native storage, runtime guards, staged audit,
 * and the private adapter stay inside this feature.
 */
export { teamActivitySurface } from './surface';
export { useTeamActivityFeed } from './useTeamActivityFeed';
export {
  activityToolRegistry,
  createActivityToolComposition,
  defaultActivityToolComposition,
  type ActivityToolComposition,
  type ActivityToolContext,
  type ActivityToolDescriptor,
  type ActivityToolState,
  type ActivityToolStateValue,
} from './activityToolRegistry';
export type {
  AddTeamActivityComment,
  CreateTeamActivityPost,
  SetTeamActivityReaction,
  TeamActivityComment,
  TeamActivityFeed,
  TeamActivityItem,
  TeamActivityMutationAuthor,
  TeamActivityPost,
  TeamActivityReaction,
} from './contracts';
