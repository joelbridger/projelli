import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { CrmEngineFreshness } from '@/platform/crm/store';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { TimelineRecord } from '@/features/crm-timeline';
import type { CrmClientsActions, CrmProposal, HouseholdRecord } from './adapters';
import { clientMapTab } from './clientMapTab';
import { activityTab } from './fallbackTabs';
import { documentsTab } from '@/features/crm-documents/surface';
import { timelineTab } from '@/features/crm-timeline/tabSurface';
import { emailTab, meetingsTab } from '@/features/crm-connectors/tabSurface';
import { meetingNotesTab } from './meetingNotesTab';
import { reviewsTab } from './reviewsTab';

export type HouseholdTab = 'client_map' | 'timeline' | 'documents' | 'email' | 'meeting_notes' | 'meetings' | 'reviews' | 'activity';

export interface HouseholdTabSurfaceProps {
  household: HouseholdRecord;
  proposals: readonly CrmProposal[];
  actions?: CrmClientsActions;
  timelineRecords: readonly TimelineRecord[];
  timelineFreshness?: CrmEngineFreshness;
  onSaveActivityRecord?: (record: LiveCrmRecord) => Promise<unknown> | unknown;
  renderLegacySurface: (id: HouseholdTab) => ReactNode;
}

export interface HouseholdTabDescriptor {
  id: string;
  label: string;
  icon: LucideIcon;
  route: HouseholdTab;
  Component: ComponentType<HouseholdTabSurfaceProps>;
}

/** The single append-only list of household tabs; no feature edits the record surface to mount itself. */
export const householdTabRegistry: readonly HouseholdTabDescriptor[] = [
  clientMapTab,
  timelineTab,
  documentsTab,
  emailTab,
  meetingNotesTab,
  meetingsTab,
  reviewsTab,
  activityTab,
];
