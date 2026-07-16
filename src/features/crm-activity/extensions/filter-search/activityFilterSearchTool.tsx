import { isEnabled } from '@/platform/flags';
import type {
  ActivityToolContext,
  ActivityToolDescriptor,
  TeamActivityItem,
} from '@/features/crm-activity/team-feed';
import { ActivityFilterSearch, ActivityFilterSearchEmpty } from './ActivityFilterSearch';
import {
  activityFilterSearchState,
  defaultActivityFilterSearchState,
  matchesActivityFilterSearch,
  type ActivityFilterSearchState,
} from './selectors';

function reset(context: ActivityToolContext<ActivityFilterSearchState>): void {
  context.state.set(defaultActivityFilterSearchState);
}

function hasFilters(context: ActivityToolContext<ActivityFilterSearchState>): boolean {
  const state = activityFilterSearchState(context.state.get());
  return Boolean(state.query || state.kind !== 'all' || state.authorId);
}

/** The descriptor itself is dark before it receives item copies or mounts UI. */
export const activityFilterSearchTool = {
  id: 'activity-filter-search',
  order: 100,
  isEnabled: () => isEnabled('activity-filter-search'),
  mount: (context) => <ActivityFilterSearch context={context} />,
  filter: (item: TeamActivityItem, context) =>
    matchesActivityFilterSearch(item, activityFilterSearchState(context.state.get())),
  renderEmptyResult: (context) => <ActivityFilterSearchEmpty
    isFiltered={hasFilters(context)}
    onReset={() => { reset(context); }}
  />,
} satisfies ActivityToolDescriptor<ActivityFilterSearchState>;
