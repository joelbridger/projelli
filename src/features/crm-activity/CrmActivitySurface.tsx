/* eslint-disable lantern-i18n/no-hardcoded-string -- frozen CRM activity copy */
import { useEffect, useMemo, useState } from 'react';
import { Bell, Clock3, MessageSquarePlus } from 'lucide-react';
import { Button, EmptyState, SurfaceToolbar } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { sendFirmMention, pullFirmInbox } from './notificationRuntime';
import { useFirmStore } from '@/platform/firm/firmStore';

const panelStyle = { border: '1px solid var(--kp-border)', borderRadius: 'var(--radius-lg)', background: 'var(--kp-surface)', padding: 'var(--kp-space-md)' } as const;
const mutedStyle = { color: 'var(--kp-text-faint)', fontSize: 'var(--kp-font-sm)' } as const;
const REACTION_OPTIONS = [
  { emoji: '👍', label: 'Like' },
  { emoji: '🎉', label: 'Celebrate' },
  { emoji: '❤️', label: 'Appreciate' },
] as const;

type NotificationRecord = LiveCrmRecord & {
  recipientUserId?: string;
  subject?: string;
  type?: string;
  createdAt?: string;
  ciphertextBand?: string;
  readOnDevices?: string[];
  targetRef?: { kind?: string; id?: string };
};

type ActivityReaction = LiveCrmRecord & {
  kind: 'activityReaction';
  activityId: string;
  userId: string;
  displayName: string;
  emoji: string;
  active: boolean;
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
  return 'Open saved item';
}

function notificationText(record: NotificationRecord) {
  if (typeof record.subject === 'string') return record.subject;
  if (record.type === 'mention') return 'You were mentioned in an internal note';
  if (record.type === 'task_assigned' || record.type === 'task_reassigned') return 'New assignment';
  if (record.type === 'approval_requested') return 'Approval needs review';
  if (record.type === 'workflow_due') return 'Workflow step is due';
  return 'Firm notification';
}

function reactionTitle(label: string, reactions: readonly ActivityReaction[]) {
  const names = reactions.map((reaction) => reaction.displayName).filter(Boolean);
  return names.length === 0 ? `Add ${label} reaction` : `${label}: ${names.join(', ')}`;
}

function ActivityReactions({
  activity,
  reactions,
  currentUserId,
  onToggle,
}: {
  activity: LiveCrmRecord;
  reactions: readonly ActivityReaction[];
  currentUserId: string;
  onToggle: (activity: LiveCrmRecord, emoji: string) => Promise<void>;
}) {
  return <div data-testid={`crm-activity-reactions-${activity.id}`} aria-label="Reactions" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
    {REACTION_OPTIONS.map(({ emoji, label }) => {
      const matching = reactions.filter((reaction) => reaction.emoji === emoji && reaction.active);
      const selected = matching.some((reaction) => reaction.userId === currentUserId);
      return <button
        key={emoji}
        type="button"
        data-testid={`crm-activity-reaction-${label.toLowerCase()}-${activity.id}`}
        aria-label={`${selected ? 'Remove' : 'Add'} ${label} reaction`}
        aria-pressed={selected}
        title={reactionTitle(label, matching)}
        onClick={() => { void onToggle(activity, emoji); }}
        style={{
          border: `1px solid ${selected ? 'var(--kp-accent)' : 'var(--kp-border)'}`,
          background: selected ? 'var(--kp-accent-soft)' : 'var(--kp-surface)',
          color: 'var(--kp-text)',
          borderRadius: 999,
          padding: '3px 8px',
          cursor: 'pointer',
          font: 'inherit',
        }}
      >{emoji}{matching.length > 0 ? ` ${matching.length}` : ''}</button>;
    })}
  </div>;
}

function NotificationInbox({ records, currentUserId, onOpen }: { records: readonly NotificationRecord[]; currentUserId: string; onOpen: (record: NotificationRecord) => void }) {
  const [read, setRead] = useState(() => readIds(currentUserId));
  const mine = records.filter((record) => record.recipientUserId === currentUserId).sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''));
  const unread = mine.filter((record) => !read.has(record.id));
  const markAll = () => { const next = new Set([...read, ...mine.map((record) => record.id)]); setRead(next); writeIds(currentUserId, next); };
  return <section data-testid="crm-notification-inbox" style={panelStyle}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><div><h2 style={{ margin: 0 }}>Notifications ({String(unread.length)})</h2><p style={{ ...mutedStyle, marginBottom: 0 }}>Read marks stay on this device. They are not shared with your firm.</p></div><Button data-testid="crm-notifications-read" size="sm" variant="secondary" disabled={mine.length === 0 || unread.length === 0} onClick={markAll}>Mark all read on this device</Button></div>
    <p style={mutedStyle}>Notification details stay private. The delivery service only sees enough to deliver the message.</p>
    {mine.length === 0 ? <EmptyState icon={Bell} title="No notifications yet" body="Assignments, approval requests, workflow due dates, and mentions will appear here." /> : <div>{mine.map((record) => <article key={record.id} data-testid={`crm-notification-${record.id}`} style={{ borderTop: '1px solid var(--kp-border)', padding: '10px 0', opacity: read.has(record.id) ? 0.7 : 1 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{notificationText(record)}</strong>{!read.has(record.id) && <span aria-label="Unread" style={{ color: 'var(--kp-assured)' }}>New</span>}</div><p style={{ ...mutedStyle, margin: '5px 0' }}>For you · sent {dateLabel(record.createdAt)}</p><Button size="sm" variant="secondary" data-testid={`crm-notification-open-${record.id}`} onClick={() => { const next = new Set(read).add(record.id); setRead(next); writeIds(currentUserId, next); onOpen(record); }}>Open</Button></article>)}</div>}
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
  const activities = useMemo(() => live.records.filter((record) => record.kind === 'activityEvent' && typeof record['at'] === 'string').sort((a, b) => Date.parse(String(b['at'])) - Date.parse(String(a['at']))), [live.records]);
  const members = useMemo(() => live.records.filter((record) => record.kind === 'firmDirectoryEntry' && record['active'] === true && typeof record['userId'] === 'string' && typeof record['displayName'] === 'string').map((record) => ({ userId: record['userId'] as string, displayName: record['displayName'] as string })), [live.records]);
  const currentUserId = signedInUserId ?? members[0]?.userId ?? 'local-user';
  const currentUserName = members.find((member) => member.userId === currentUserId)?.displayName ?? 'You';
  const reactions = useMemo(() => live.records.filter((record): record is ActivityReaction => record.kind === 'activityReaction' && typeof record['activityId'] === 'string' && typeof record['userId'] === 'string' && typeof record['displayName'] === 'string' && typeof record['emoji'] === 'string' && record['active'] === true), [live.records]);
  useEffect(() => { if (!live.workspaceRoot) return; void pullFirmInbox(live.workspaceRoot).then((pulled) => { if (pulled) void live.reload(); }).catch(() => undefined); }, [live.reload, live.workspaceRoot]);
  const notifications = useMemo(() => live.records.flatMap((record): NotificationRecord[] => {
    if (record.kind === 'notificationEnvelope') return [record as NotificationRecord];
    if (record.kind !== 'crmNotifyInbox' || !record['row'] || typeof record['row'] !== 'object') return [];
    const row = record['row'] as { createdAt?: unknown; ciphertextB64?: unknown; payload?: { type?: unknown; subjectRef?: unknown; pointer?: { referenceId?: unknown } } | null };
    return [{ id: record.id, kind: 'notificationEnvelope', matterId: 'firm_home', recipientUserId: currentUserId, type: typeof row.payload?.type === 'string' ? row.payload.type : 'firm_notice', ...(typeof row.payload?.subjectRef === 'string' ? { subject: row.payload.subjectRef } : {}), ...(typeof row.createdAt === 'string' ? { createdAt: row.createdAt } : {}), ciphertextBand: typeof row.ciphertextB64 === 'string' ? `${String(Math.round(atob(row.ciphertextB64).length / 1024) || 1)} KiB` : 'size not available', ...(typeof row.payload?.pointer?.referenceId === 'string' ? { targetRef: { kind: 'record', id: row.payload.pointer.referenceId } } : {}) }];
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
  const toggleReaction = async (activity: LiveCrmRecord, emoji: string) => {
    const existing = live.records.find((record) => record.kind === 'activityReaction' && record['activityId'] === activity.id && record['userId'] === currentUserId && record['emoji'] === emoji);
    const now = new Date().toISOString();
    await live.save({
      ...(existing ?? {}),
      id: existing?.id ?? `activity-reaction:${activity.id}:${currentUserId}:${emoji.codePointAt(0)}`,
      kind: 'activityReaction',
      matterId: activity.matterId ?? 'firm_home',
      activityId: activity.id,
      userId: currentUserId,
      displayName: currentUserName,
      emoji,
      active: existing?.['active'] !== true,
      ...(existing?.['active'] === true ? { removedAt: now } : { reactedAt: now, removedAt: null }),
    });
  };
  const recordUpdate = async () => { const at = new Date().toISOString(); await live.save({ id: `activity:${crypto.randomUUID()}`, kind: 'activityEvent', matterId: 'firm_home', at, summary: 'Recorded a firm activity update', actor: { userId: currentUserId, displayName: 'You' }, verb: 'firm.update_recorded', targetRef: { kind: 'firm', id: 'firm_home' }, important: false }); };
  return <div data-testid="crm-activity-surface" style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%', display: 'grid', gap: 'var(--kp-space-md)', alignContent: 'start' }}><SurfaceHeader Icon={Clock3} title="Firm activity" description="A dated history of work across your firm" />{live.error && <p role="alert">Could not load firm activity: {live.error}</p>}<SurfaceToolbar><span style={mutedStyle}>React to updates to show quick appreciation or agreement.</span><Button size="sm" data-testid="crm-firm-activity-create" onClick={() => { void recordUpdate(); }}>Record firm update</Button></SurfaceToolbar><section data-testid="crm-firm-activity-feed" style={panelStyle}><h2 style={{ marginTop: 0 }}>Activity</h2>{activities.length === 0 ? <EmptyState icon={Clock3} title="No firm activity yet" body="Saved tasks, workflow work, notes, and other firm changes will appear here." /> : activities.map((record) => <article key={record.id} data-testid={`crm-firm-activity-${record.id}`} style={{ borderTop: '1px solid var(--kp-border)', padding: '10px 0' }}><strong>{activityLabel(record)}</strong><p style={{ ...mutedStyle, margin: '5px 0' }}>{dateLabel(record['at'] as string)}</p><ActivityReactions activity={record} reactions={reactions.filter((reaction) => reaction.activityId === record.id)} currentUserId={currentUserId} onToggle={toggleReaction} /><Button size="sm" variant="secondary" data-testid={`crm-firm-activity-open-${record.id}`} onClick={() => setOpened(record)}>{sourceLabel(record)}</Button></article>)}</section><NotificationInbox records={notifications} currentUserId={currentUserId} onOpen={setOpened} /><MentionNote members={members} onSave={saveNote} />{opened && <section data-testid="crm-activity-source" style={panelStyle}><strong>Saved activity</strong><p style={mutedStyle}>This activity is linked to a saved item in your firm.</p><Button size="sm" variant="secondary" onClick={() => setOpened(null)}>Close</Button></section>}</div>;
}
