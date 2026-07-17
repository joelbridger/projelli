import { createElement, type ComponentType, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { CrmEngineFreshness } from '@/platform/crm/store';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { TimelineRecord } from '@/features/crm-timeline';
import type { ClientBoundary } from '@/features/meetings';
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
import { isEnabled } from '@/platform/flags';
import { SchwabPrefillReview } from '@/features/accounts';

function SchwabReviewsGate(props: HouseholdTabSurfaceProps) {
  return isEnabled('schwab-prefill')
    ? createElement(
        'div',
        undefined,
        createElement(reviewsTab.Component, props),
        createElement(SchwabPrefillReview, { household: props.household })
      )
    : null;
}

/** Feature modules augment this map beside their tab descriptor. */
export interface HouseholdTabRouteMap {}
export type HouseholdTab = string;

export interface HouseholdTabSurfaceProps {
  household: HouseholdRecord;
  /** Absent when the record surface has no authoritative matter linkage. */
  clientBoundary?: ClientBoundary;
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
const registeredHouseholdTabs: HouseholdTabDescriptor[] = [
  clientMapTab,
  timelineTab,
  documentsTab,
  emailTab,
  meetingNotesTab,
  meetingsTab,
  isEnabled('schwab-prefill')
    ? { ...reviewsTab, Component: SchwabReviewsGate }
    : reviewsTab,
  activityTab,
  ...(isEnabled('record-member-kebab') ? [memberRailTab] : []),
];
export const householdTabRegistry: readonly HouseholdTabDescriptor[] =
  registeredHouseholdTabs;

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

/** Add a public tab to the live registry and return its cleanup function. */
export function registerHouseholdTab(
  descriptor: HouseholdTabDescriptor
): () => void {
  validateHouseholdTabDescriptors([...householdTabRegistry, descriptor]);
  registeredHouseholdTabs.push(descriptor);
  return () => {
    const index = registeredHouseholdTabs.indexOf(descriptor);
    if (index >= 0) registeredHouseholdTabs.splice(index, 1);
  };
}
