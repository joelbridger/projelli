/**
 * Notice Card — adapter registry.
 *
 * Maps a platform to its join adapter. Only the platforms we can actually drive
 * a guest join for (Teams, Zoom) have an adapter; Meet / unknown URLs return
 * null and fall back to the honest "say the notice aloud" path.
 */
import type { NoticeCardPlatform } from '../noticeCardTypes';
import type { JoinAdapter } from './adapterTypes';
import { teamsAdapter } from './teamsAdapter';
import { zoomAdapter } from './zoomAdapter';

export function adapterFor(platform: NoticeCardPlatform): JoinAdapter | null {
  switch (platform) {
    case 'teams':
      return teamsAdapter;
    case 'zoom':
      return zoomAdapter;
    default:
      return null;
  }
}

export { teamsAdapter, zoomAdapter };
export type { JoinAdapter, AdapterPhase } from './adapterTypes';
