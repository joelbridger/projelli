import {
  filterOwnClientRecords,
  type OwnClientsContext,
} from '@/features/crm-permissions';
import type { TeamActivityItem } from '@/features/crm-activity/team-feed';

// The permission doorway intentionally has no trusted current-member provider
// or durable activity ownership labels yet. This empty renderer context is
// therefore fail-closed if native enforcement turns on before those seams
// land. Display author IDs and names must never be substituted for authority.
const stagedPermissionContext: OwnClientsContext = {
  memberId: '',
  role: undefined,
  operation: 'read',
};

/**
 * Mirrors native visibility through the required batch doorway. The adapter
 * carries only the durable record identity available from the public feed;
 * it deliberately invents no owner or assignment labels.
 */
export function permissionVisibleActivityItemIds(
  items: readonly TeamActivityItem[],
  enforcementActive: boolean,
): readonly string[] {
  const records = items.map((item) => ({
    id: item.id,
    kind: 'teamActivityPost',
  }));
  return filterOwnClientRecords(
    records,
    stagedPermissionContext,
    enforcementActive,
  ).map((record) => record.id);
}
