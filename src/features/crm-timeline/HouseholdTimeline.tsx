/* eslint-disable lantern-i18n/no-hardcoded-string -- frozen CRM copy */
import { useMemo, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { Card, EmptyState, SurfaceToolbar } from '@/ui/kp';
import type { CrmEngineFreshness } from '@/platform/crm/store';
import { EV_OPEN_CRM_DOCUMENT } from '@/config/identity';
import { buildHouseholdTimeline } from './buildTimeline';
import type { TimelineEntryType, TimelineHousehold, TimelineRecord, TimelineSource } from './types';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { ActivityThread } from '@/features/crm-activity/ActivityThread';
import { useFirmStore } from '@/platform/firm/firmStore';

const labels: Record<TimelineEntryType | 'all', string> = { all: 'All activity', note: 'Notes', fact: 'Facts', task: 'Completed tasks', workflow: 'Workflows', activity: 'Activity', email: 'Email', meeting: 'Meetings', document: 'Documents' };

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function freshnessCopy(freshness: CrmEngineFreshness) {
  if (freshness.kind === 'idle') return 'Up to date on this device';
  if (freshness.kind === 'live') return 'Up to date';
  if (freshness.kind === 'syncing') return 'Updating. New changes may still arrive.';
  if (freshness.kind === 'offline') return 'Working offline. Showing saved history on this device.';
  if (freshness.kind === 'last-synced') return `Last updated ${freshness.lastSyncedAt ?? 'previously'}.`;
  return 'History may be incomplete. Check the connection and try again.';
}

function SourceLink({ source, onOpen }: { source: TimelineSource; onOpen: (source: TimelineSource) => void }) {
  return <button type="button" className="kp-button kp-button--secondary kp-button--sm" onClick={() => onOpen(source)} data-testid={`crm-timeline-source-${source.kind}-${source.id}`}>Open {source.label}</button>;
}

export function HouseholdTimeline({ household, records, freshness, onSaveActivityRecord }: { household: TimelineHousehold; records: readonly TimelineRecord[]; freshness: CrmEngineFreshness; onSaveActivityRecord?: (record: LiveCrmRecord) => Promise<unknown> | unknown }) {
  const signedInUserId = useFirmStore((state) => state.session?.userId);
  const [type, setType] = useState<TimelineEntryType | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openedSource, setOpenedSource] = useState<TimelineSource | null>(null);
  const openSource = (source: TimelineSource) => {
    if (source.kind === 'document') {
      window.dispatchEvent(new CustomEvent(EV_OPEN_CRM_DOCUMENT, { detail: { path: source.id, name: source.label } }));
      return;
    }
    setOpenedSource(source);
  };
  const entries = useMemo(() => buildHouseholdTimeline(household, records).filter((entry) => {
    const day = entry.at.slice(0, 10);
    return (type === 'all' || entry.type === type) && (!from || day >= from) && (!to || day <= to);
  }), [from, household, records, to, type]);
  const fallbackMember = records.find((record) => record.kind === 'firmDirectoryEntry' && typeof record['userId'] === 'string');
  const currentUserId = signedInUserId ?? (typeof fallbackMember?.['userId'] === 'string' ? fallbackMember['userId'] : 'local-user');
  const memberForUser = records.find((record) => record.kind === 'firmDirectoryEntry' && record['userId'] === currentUserId);
  const currentUser = { userId: currentUserId, displayName: typeof memberForUser?.['displayName'] === 'string' ? memberForUser['displayName'] : 'You' };
  return <section data-testid="crm-household-timeline" style={{ display: 'grid', gap: 12, marginTop: 14 }}>
    <SurfaceToolbar>
      <label>Show <select aria-label="Timeline type" data-testid="crm-timeline-type" value={type} onChange={(event) => setType(event.target.value as TimelineEntryType | 'all')}>
        {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>From <input aria-label="Timeline from date" data-testid="crm-timeline-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>To <input aria-label="Timeline to date" data-testid="crm-timeline-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <span aria-live="polite" data-testid="crm-timeline-freshness">{freshnessCopy(freshness)}</span>
    </SurfaceToolbar>
    {entries.length === 0 ? <EmptyState icon={Clock3} title="No history matches these filters" body="Notes, facts, completed tasks, workflows, and linked email, meetings, and documents will appear here when they exist." /> : entries.map((entry) => <Card key={entry.id} variant="raised" data-testid={`crm-timeline-entry-${entry.id}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><strong>{entry.summary}</strong><span>{labels[entry.type]}</span></div>
      <p style={{ marginBottom: 6 }}>{formatDate(entry.at)} · {entry.who}</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><SourceLink source={entry.source} onOpen={openSource} />{entry.provenance.map((item) => <SourceLink key={`${item.kind}:${item.id}`} source={item} onOpen={openSource} />)}</div>
      {entry.type === 'activity' ? (() => { const activity = records.find((record) => record.kind === 'activityEvent' && record.id === entry.source.id); return activity ? <ActivityThread activity={activity as LiveCrmRecord} records={records as readonly LiveCrmRecord[]} currentUser={currentUser} {...(onSaveActivityRecord ? { onSave: onSaveActivityRecord } : {})} readOnly={!onSaveActivityRecord} /> : null; })() : null}
    </Card>)}
    {openedSource ? <Card variant="raised" data-testid="crm-timeline-source-detail">
      <h2>{openedSource.label}</h2>
      <p>This entry points to the saved {openedSource.kind} record. Open it in its own area to review the original details.</p>
      <p>This is a link to the saved {openedSource.kind} record.</p>
    </Card> : null}
  </section>;
}
