import { History } from 'lucide-react';
import type { ReactNode } from 'react';
import type { HouseholdTab, HouseholdTabDescriptor } from './tabRegistry';

function LegacyTab({ route, renderLegacySurface }: { route: 'activity'; renderLegacySurface: (id: HouseholdTab) => ReactNode }) {
  return <>{renderLegacySurface(route)}</>;
}

export const activityTab: HouseholdTabDescriptor = { id: 'activity', label: 'Activity', icon: History, route: 'activity', Component: ({ renderLegacySurface }) => <LegacyTab route="activity" renderLegacySurface={renderLegacySurface} /> };
