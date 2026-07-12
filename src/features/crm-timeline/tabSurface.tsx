import { Clock3 } from 'lucide-react';
import { HouseholdTimeline } from './HouseholdTimeline';
import type { HouseholdTabDescriptor } from '@/features/crm-clients/tabRegistry';

export const timelineTab: HouseholdTabDescriptor = {
  id: 'timeline',
  label: 'Timeline',
  icon: Clock3,
  route: 'timeline',
  Component: ({ household, timelineRecords, timelineFreshness, onSaveActivityRecord, renderLegacySurface }) => timelineFreshness ? <HouseholdTimeline household={{ id: household.id, notes: household.notes, facts: household.facts }} records={timelineRecords} freshness={timelineFreshness} {...(onSaveActivityRecord ? { onSaveActivityRecord } : {})} /> : <>{renderLegacySurface('timeline')}</>,
};
