/* eslint-disable lantern-i18n/no-hardcoded-string -- frozen CRM activity copy */
import { useEffect, useMemo, useState } from 'react';
import { Bell, Clock3, MessageSquarePlus } from 'lucide-react';
import { Button, EmptyState, SurfaceToolbar } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { sendFirmMention, pullFirmInbox } from './notificationRuntime';
import { useFirmStore } from '@/platform/firm/firmStore';
import { ActivityThread } from '@/platform/crm/ActivityThread';

const panelStyle = { border: '1px solid var(--kp-border)', borderRadius: 'var(--radius-lg)', background: 'var(--kp-surface)', padding: 'var(--kp-space-md)' } as const;
const mutedStyle = { color: 'var(--kp-text-faint)', fontSize: 'var(--kp-font-sm)' } as const;

type NotificationRecord = LiveCrmRecord & {
  recipientUserId?: string;
  subject?: string;
  type?: string;
  createdAt?: string;
  opaqueId?: string;
  ciphertextBand?: string;
  readOnDevices?: string[];
  targetRef?: { kind?: string; id?: string };
};

function dateLabel(value: string | undefined) {
  if (!value) return 'Date not available';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Date not available' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function activityLabel(record: LiveCrmRecord) {
  return typeof record['summary'] === 'string' ? record['summary'] : 'Firm activity recorded';
}

function localReadKey(userId: string) { return `lantern.crm.notification.read.v1:${userId}`; }

function readIds(userId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(localReadKey(userId)) ?? '[]') as string[]); } catch { return new Set(); }
}

function writeIds(userId: string, values: Set<string>) {
  localStorage.setItem(localReadKey(userId), JSON.stringify([...values]));
}

function sourceLabel(record: LiveCrmRecord) {
  const target = record['targetRef'];
  if (target && typeof target === 'object' && typeof (target as { kind?: unknown }).kind === 'string') return `Open ${(target as { kind: string }).kind.replaceAll('_', ' ')}`;
  return 'Open saved record';
}

function notificationText(record: NotificationRecord) {
  if (typeof record.subject === 'string') return record.subject;
  if (record.type === 'mention') return 'You were mentioned in an internal note';
  if (record.type === 'task_assigned' || record.type === 'task_reassigned') return 'New assignment';
  if (record.type === 'approval_requested') return 'Approval needs review';
  if (record.type === 'workflow_due') return 'Workflow step is due';
  return 'Firm notification';
}

function NotificationInbox({ records, currentUserId, onOpen }: { records: readonly NotificationRecord[]; currentUserId: string; onOpen: (record: NotificationRecord) => void }) {
  const [read, setRead] = useState(() => readIds(currentUserId));
  const mine = records.filter((record) => record.recipientUserId === currentUserId).sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''));
  const unread = mine.filter((record) => !read.has(record.id));
  const markAll = () => { const next = new Set([...read, ...mine.map((record) => record.id)]); setRead(next); writeIds(currentUserId, next); };
  return <section data-testid="crm-notification-inbox" style={panelStyle}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><div><h2 style={{ margin: 0 }}>Notifications ({String(unread.length)})</h2><p style={{ ...mutedStyle, marginBottom: 0 }}>Read marks stay on this device. They are not shared with your firm.</p></div><Button data-testid="crm-notifications-read" size="sm" variant="secondary" disabled={mine.length === 0 || unread.length === 0} onClick={markAll}>Mark all read on this device</Button></div>
    <p style={mutedStyle}>The delivery service can see that an alert was sent, but it cannot read the alert itself.</p>
    {mine.length === 0 ? <EmptyState icon={Bell} title="No notifications yet" body="Assignments, approval requests, workflow due dates, and mentions will appear here." /> : <div>{mine.map((record) => <article key={record.id} data-testid={`crm-notification-${record.id}`} style={{ borderTop: '1px solid var(--kp-border)', padding: '10px 0', opacity: read.has(record.id) ? 0.7 : 1 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{notificationText(record)}</strong>{!read.has(record.id) && <span aria-label="Unread" style={{ color: 'var(--kp-assured)' }}>New</span>}</div><p style={{ ...mutedStyle, margin: '5px 0' }}>Recipient: you · sent {dateLabel(record.createdAt)} · encrypted alert size: {record.ciphertextBand ?? 'not available'}</p><Button size="sm" variant="secondary" data-testid={`crm-notification-open-${record.id}`} onClick={() => { const next = new Set(read).add(record.id); setRead(next); writeIds(currentUserId, next); onOpen(record); }}>Open</Button></article>)}</div>}
  </section>;
}

function MentionNote({ members, onSave }: { members: readonly { userId: string; displayName: string }[]; onSave: (body: string, mentioned: readonly { userId: string; displayName: string }[]) => Promise<void> }) {
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const toggle = (userId: string) => setMentions((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]);
  const save = async (value = body) => { setSaving(true); try { await onSave(value.trim(), members.filter((member) => mentions.includes(member.userId))); setBody(''); setMentions([]); } finally { setSaving(false); } };
  return <section data-testid="crm-activity-note" style={panelStyle}><h2 style={{ marginTop: 0 }}>Internal note</h2><p style={mutedStyle}>Choose people to notify before saving. This is an internal note, not an email.</p><textarea data-testid="crm-activity-note-body" aria-label="Internal note" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a note for the firm" style={{ width: '100%', minHeight: 84 }} />
    <fieldset style={{ border: 0, padding: 0, margin: '10px 0' }}><legend style={mutedStyle}>Notify people with @mentions</legend>{members.length === 0 ? <p style={mutedStyle}>Add active firm members before you can mention someone.</p> : members.map((member) => <label key={member.userId} style={{ marginRight: 12 }}><input data-testid={`crm-activity-mention-${member.userId}`} type="checkbox" checked={mentions.includes(member.userId)} onChange={() => toggle(member.userId)} /> @{member.displayName}</label>)}</fieldset>
    {mentions.length > 0 && <p data-testid="crm-activity-mention-review" style={mutedStyle}>Will notify: {members.filter((member) => mentions.includes(member.userId)).map((member) => member.displayName).join(', ')}.</p>}<Button data-testid="crm-activity-note-save" disabled={!body.trim() || saving} iconLeft={MessageSquarePlus} onClick={() => { void save(); }}>{saving ? 'Saving…' : 'Save internal note'}</Button><Button data-testid="crm-timeline-mention" size="sm" variant="secondary" style={{ marginLeft: 8 }} onClick={() => { setBody((value) => value || 'Team update'); }}>Add @mention</Button><Button data-testid="crm-timeline-post" size="sm" style={{ marginLeft: 8 }} disabled={saving} onClick={() => { void save(body.trim() || 'Team update'); }}>Post to activity</Button>
  </section>;
}

export function CrmActivitySurface() {
  const live = useLiveCrmRecords();
  const signedInUserId = useFirmStore((state) => state.session?.userId);
  const [opened, setOpened] = useState<LiveCrmRecord | null>(null);
  const [householdId, setHouseholdId] = useState('');
  const activities = useMemo(() => live.records.filter((record) => record.kind === 'activityEvent' && typeof record['at'] === 'string').sort((a, b) => Date.parse(String(b['at'])) - Date.parse(String(a['at']))), [live.records]);
  const households = useMemo(() => live.records.filter((record) => record.kind === 'household' && typeof record['name'] === 'string').map((record) => ({ id: record.id, name: record['name'] as string, matterId: record.matterId })), [live.records]);
  const members = useMemo(() => live.records.filter((record) => record.kind === 'firmDirectoryEntry' && record['active'] === true && typeof record['userId'] === 'string' && typeof record['displayName'] === 'string').map((record) => ({ userId: record['userId'] as string, displayName: record['displayName'] as string })), [live.records]);
  const currentUserId = signedInUserId ?? members[0]?.userId ?? 'local-user';
  const currentUser = { userId: currentUserId, displayName: members.find((member) => member.userId === currentUserId)?.displayName ?? 'You' };
  useEffect(() => { if (!live.workspaceRoot) return; void pullFirmInbox(live.workspaceRoot).then((pulled) => { if (pulled) void live.reload(); }).catch(() => undefined); }, [live.reload, live.workspaceRoot]);
  const notifications = useMemo(() => live.records.flatMap((record): NotificationRecord[] => {
    if (record.kind === 'notificationEnvelope') return [record as NotificationRecord];
    if (record.kind !== 'crmNotifyInbox' || !record['row'] || typeof record['row'] !== 'object') return [];
    const row = record['row'] as { envelopeId?: unknown; createdAt?: unknown; ciphertextB64?: unknown; payload?: { type?: unknown; subjectRef?: unknown; pointer?: { referenceId?: unknown } } | null };
    return [{ id: record.id, kind: 'notificationEnvelope', matterId: 'firm_home', recipientUserId: currentUserId, type: typeof row.payload?.type === 'string' ? row.payload.type : 'firm_notice', ...(typeof row.payload?.subjectRef === 'string' ? { subject: row.payload.subjectRef } : {}), ...(typeof row.createdAt === 'string' ? { createdAt: row.createdAt } : {}), opaqueId: typeof row.envelopeId === 'string' ? row.envelopeId : record.id, ciphertextBand: typeof row.ciphertextB64 === 'string' ? `${String(Math.round(atob(row.ciphertextB64).length / 1024) || 1)} KiB` : 'size not available', ...(typeof row.payload?.pointer?.referenceId === 'string' ? { targetRef: { kind: 'record', id: row.payload.pointer.referenceId } } : {}) }];
  }), [currentUserId, live.records]);
  const saveNote = async (body: string, mentioned: readonly { userId: string; displayName: string }[]) => {
    const now = new Date().toISOString();
    const noteId = `note-${crypto.randomUUID()}`;
    const note = { id: noteId, kind: 'note', matterId: 'firm_home', body, audience: 'internal', pinned: false, mentions: mentioned.map((member) => ({ id: `mention-${crypto.randomUUID()}`, ref: { kind: 'firmDirectoryEntry', id: member.userId }, notifyState: 'pending' })), createdAt: now, updatedAt: now };
    await live.save(note);
    await live.save({ id: `activity-${crypto.randomUUID()}`, kind: 'activityEvent', matterId: 'firm_home', at: now, summary: mentioned.length ? `Added an internal note and mentioned ${mentioned.map((member) => member.displayName).join(', ')}` : 'Added an internal note', actor: { userId: currentUserId, displayName: 'You' }, verb: 'note.created', targetRef: { kind: 'note', id: noteId }, payload: { mentionCount: mentioned.length }, important: false });
    const sent = await Promise.all(mentioned.map(async (member) => ({ userId: member.userId, sent: Boolean(live.workspaceRoot && live.sharedMatterId && await sendFirmMention({ workspaceRoot: live.workspaceRoot, firmMatterId: live.sharedMatterId, recipientUserId: member.userId, noteId })) })));
    await live.save({ ...note, mentions: note.mentions.map((mention) => ({ ...mention, notifyState: sent.find((result) => result.userId === mention.ref.id)?.sent ? 'sent' : 'pending' })), updatedAt: new Date().toISOString() });
  };
  const recordUpdate = async () => {
    const at = new Date().toISOString();
    const household = households.find((item) => item.id === householdId);
    await live.save({ id: `activity:${crypto.randomUUID()}`, kind: 'activityEvent', matterId: household?.matterId ?? 'firm_home', at, summary: household ? `Recorded an update for ${household.name}` : 'Recorded a firm activity update', actor: { userId: currentUserId, displayName: currentUser.displayName }, verb: 'firm.update_recorded', targetRef: household ? { kind: 'household', id: household.id, label: household.name } : { kind: 'firm', id: 'firm_home' }, ...(household ? { householdId: household.id } : {}), payload: {}, important: false });
  };
  return <div data-testid="crm-activity-surface" style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%', display: 'grid', gap: 'var(--kp-space-md)', alignContent: 'start' }}><SurfaceHeader Icon={Clock3} title="Firm activity" description="A dated history of work and the conversations around it" />{live.error && <p role="alert">Could not load firm activity: {live.error}</p>}<SurfaceToolbar><label style={mutedStyle}>Client <select data-testid="crm-activity-household" aria-label="Client for this activity" value={householdId} onChange={(event) => setHouseholdId(event.target.value)}><option value="">Firm-wide update</option>{households.map((household) => <option key={household.id} value={household.id}>{household.name}</option>)}</select></label><Button size="sm" data-testid="crm-firm-activity-create" onClick={() => { void recordUpdate(); }}>Record activity</Button></SurfaceToolbar><section data-testid="crm-firm-activity-feed" style={panelStyle}><h2 style={{ marginTop: 0 }}>Activity</h2>{activities.length === 0 ? <EmptyState icon={Clock3} title="No firm activity yet" body="Record an update, then use comments and reactions to keep everyone on the same page." /> : activities.map((record) => { const household = households.find((item) => item.id === record['householdId']); return <article key={record.id} data-testid={`crm-firm-activity-${record.id}`} style={{ borderTop: '1px solid var(--kp-border)', padding: '14px 0' }}><strong>{activityLabel(record)}</strong><p style={{ ...mutedStyle, margin: '5px 0' }}>{dateLabel(record['at'] as string)}{household ? ` · ${household.name}` : ' · Firm-wide'}</p><Button size="sm" variant="secondary" data-testid={`crm-firm-activity-open-${record.id}`} onClick={() => setOpened(record)}>{sourceLabel(record)}</Button><ActivityThread activity={record} records={live.records} currentUser={currentUser} onSave={live.save} /></article>; })}</section><NotificationInbox records={notifications} currentUserId={currentUserId} onOpen={setOpened} /><MentionNote members={members} onSave={saveNote} />{opened && <section data-testid="crm-activity-source" style={panelStyle}><strong>Saved record</strong><p style={mutedStyle}>This item points to the saved record that created the activity.</p><Button size="sm" variant="secondary" onClick={() => setOpened(null)}>Close</Button></section>}</div>;
}
