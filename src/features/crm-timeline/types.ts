export type TimelineEntryType = 'note' | 'fact' | 'task' | 'workflow' | 'activity' | 'email' | 'meeting' | 'document';

export interface TimelineSource {
  kind: string;
  id: string;
  label: string;
}

export interface TimelineEntry {
  id: string;
  type: TimelineEntryType;
  at: string;
  who: string;
  summary: string;
  source: TimelineSource;
  provenance: readonly TimelineSource[];
}

export interface TimelineHousehold {
  id: string;
  matterId?: string;
  notes?: readonly { id: string; body: string; audience?: string; createdAt?: string; updatedAt?: string; author?: string }[];
  facts?: readonly { id: string; label: string; value?: string; asOf?: string; learned?: string; sources?: readonly { id: string; label: string }[] }[];
}

export interface TimelineRecord {
  id: string;
  kind: string;
  matterId?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}
