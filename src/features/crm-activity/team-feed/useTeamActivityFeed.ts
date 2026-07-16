import { useContext } from 'react';
import type { TeamActivityFeed } from './contracts';
import { TeamActivityFeedContext } from './teamActivityFeedContext';

/**
 * Public consumer doorway for feed filters mounted inside the activity screen.
 * Storage, audit, relay, workspace selection, and matter scoping are already
 * bound; consumers receive only the async feed contract.
 */
export function useTeamActivityFeed(): TeamActivityFeed {
  const feed = useContext(TeamActivityFeedContext);
  if (!feed) {
    throw new Error('useTeamActivityFeed must be used inside the enabled team activity surface.');
  }
  return feed;
}
