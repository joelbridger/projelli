import { FileText, History } from 'lucide-react';
import type { ReactNode } from 'react';
import type { HouseholdTabDescriptor } from './tabRegistry';

function LegacyTab({ route, renderLegacySurface }: { route: 'documents' | 'activity'; renderLegacySurface: (id: string) => ReactNode }) {
  return <>{renderLegacySurface(route)}</>;
}

export const documentsTab: HouseholdTabDescriptor = { id: 'documents', label: 'Documents', icon: FileText, route: 'documents', Component: ({ renderLegacySurface }) => <LegacyTab route="documents" renderLegacySurface={renderLegacySurface} /> };
export const activityTab: HouseholdTabDescriptor = { id: 'activity', label: 'Activity', icon: History, route: 'activity', Component: ({ renderLegacySurface }) => <LegacyTab route="activity" renderLegacySurface={renderLegacySurface} /> };
