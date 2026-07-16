import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { CrmEngineFreshness } from '@/platform/crm/store';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { TimelineRecord } from '@/features/crm-timeline';
import type {
  CrmClientsActions,
  CrmProposal,
  HouseholdRecord,
} from './adapters';
import { clientMapTab } from './clientMapTab';
import { activityTab } from './fallbackTabs';
import { documentsTab } from '@/features/crm-documents/surface';
import { timelineTab } from '@/features/crm-timeline/tabSurface';
import { emailTab, meetingsTab } from '@/features/crm-connectors/tabSurface';
import { meetingNotesTab } from './meetingNotesTab';
import { reviewsTab } from './reviewsTab';
import { memberRailTab } from '@/features/crm-clients/extensions/record-member-kebab';

/** Feature modules augment this map beside their tab descriptor. */
export interface HouseholdTabRouteMap {}
export type HouseholdTab = Extract<keyof HouseholdTabRouteMap, string>;

export interface HouseholdTabSurfaceProps {
  household: HouseholdRecord;
  proposals: readonly CrmProposal[];
  actions?: CrmClientsActions;
  timelineRecords: readonly TimelineRecord[];
  timelineFreshness?: CrmEngineFreshness;
  onSaveActivityRecord?: (record: LiveCrmRecord) => unknown;
  renderLegacySurface: (id: HouseholdTab) => ReactNode;
}

export interface HouseholdTabDescriptor {
  id: string;
  label: string;
  icon: LucideIcon;
  route: HouseholdTab;
  Component: ComponentType<HouseholdTabSurfaceProps>;
}

/** The append-only list of feature-owned household tabs. Keep existing order stable. */
export const householdTabRegistry: readonly HouseholdTabDescriptor[] = [
  clientMapTab,
  timelineTab,
  documentsTab,
  emailTab,
  meetingNotesTab,
  meetingsTab,
  reviewsTab,
  activityTab,
  memberRailTab,
];

export function validateHouseholdTabDescriptors(
  descriptors: readonly HouseholdTabDescriptor[]
): void {
  const ids = new Set<string>();
  const routes = new Set<string>();
  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id))
      throw new Error(
        `[householdTabRegistry] duplicate tab id: ${descriptor.id}`
      );
    if (routes.has(descriptor.route))
      throw new Error(
        `[householdTabRegistry] duplicate tab route: ${descriptor.route}`
      );
    ids.add(descriptor.id);
    routes.add(descriptor.route);
  }
}
