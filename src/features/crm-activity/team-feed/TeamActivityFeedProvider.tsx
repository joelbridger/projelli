import { useMemo, type ReactNode } from 'react';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { createNativeTeamActivityStore } from './activityClient';
import { createTeamActivityFeed } from './feed';
import { TeamActivityFeedContext } from './teamActivityFeedContext';

/** Internal composition boundary mounted only below the feature-flag gate. */
export function TeamActivityFeedProvider({ children }: { children: ReactNode }) {
  const live = useLiveCrmRecords();
  const feed = useMemo(() => createTeamActivityFeed(createNativeTeamActivityStore({
    workspaceRoot: live.workspaceRoot,
    publishSavedRecord: live.publishSavedRecord,
  })), [live.publishSavedRecord, live.workspaceRoot]);
  return <TeamActivityFeedContext.Provider value={feed}>{children}</TeamActivityFeedContext.Provider>;
}
