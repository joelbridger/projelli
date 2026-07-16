import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3, Heart, MessageCircle, Send, ThumbsUp } from 'lucide-react';
import { Button, EmptyState, SurfaceToolbar } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { useFlag } from '@/platform/flags';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { auditAppend, type AuditEntryRecord } from '@/platform/utils/tauri-commands';
import { useFirmStore } from '@/platform/firm/firmStore';
import { CrmActivitySurface } from '@/features/crm-activity';
import { createTeamActivityFeed } from './feed';
import type { TeamActivityFeed, TeamActivityItem } from './contracts';

const muted = { color: 'var(--kp-text-faint)', fontSize: 'var(--kp-font-sm)' } as const;
const panel = { border: '1px solid var(--kp-border)', borderRadius: 'var(--radius-lg)', background: 'var(--kp-surface)', padding: 'var(--kp-space-md)' } as const;

function auditEvent(event: { activityId: string; operation: 'post' | 'comment' | 'reaction'; mentionCount?: number }): Promise<void> {
  const entry: AuditEntryRecord = {
    id: `audit-team-activity-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    action: 'user_action',
    description: `Team activity ${event.operation} recorded`,
    // Never put post/comment text or display labels into durable audit metadata.
    payloadJson: JSON.stringify({ action: 'user_action', metadata: { activityId: event.activityId, operation: event.operation, mentionCount: event.mentionCount ?? 0 } }),
  };
  return auditAppend(entry);
}

/**
 * This is the registered replacement surface. Its only off-path operation is
 * reading the feature flag; all feed reads, subscriptions and mutations are in
 * the enabled child. Off renders the exact legacy Activity surface.
 */
export function TeamActivitySurface() {
  const enabled = useFlag('team-activity-feed');
  if (!enabled) return <CrmActivitySurface />;
  return <TeamActivitySurfaceEnabled />;
}

function TeamActivitySurfaceEnabled() {
  const { t } = useTranslation();
  const live = useLiveCrmRecords();
  const memberId = useFirmStore((state) => state.session?.userId) ?? 'renderer-local-member';
  const [items, setItems] = useState<readonly TeamActivityItem[]>([]);
  const [body, setBody] = useState('');
  const [mentionedMemberIds, setMentionedMemberIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const feed = useMemo(() => createTeamActivityFeed({
    load: () => Promise.resolve(live.records),
    save: live.save,
    subscribe: (listener) => {
      const onChange = () => { listener(); };
      window.addEventListener('lantern:crm-live-records-changed', onChange);
      return () => { window.removeEventListener('lantern:crm-live-records-changed', onChange); };
    },
    audit: auditEvent,
  }), [live.records, live.save]);
  const query = useMemo(() => ({ memberId, operation: 'read' as const, memberships: [] }), [memberId]);
  const members = useMemo(() => live.records.flatMap((record) => record.kind === 'firmDirectoryEntry' && record['active'] === true && typeof record['userId'] === 'string' && typeof record['displayName'] === 'string' ? [{ memberId: record['userId'], displayName: record['displayName'] }] : []), [live.records]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { void feed.query(query).then((next) => { if (!cancelled) setItems(next); }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); }); };
    refresh();
    const unsubscribe = feed.subscribe(refresh);
    return () => { cancelled = true; unsubscribe(); };
  }, [feed, query]);
  const post = async () => {
    if (!body.trim()) return;
    try {
      await feed.createPost({ body, author: { memberId, displayName: 'You' }, mentionedMemberIds });
      setBody('');
      setMentionedMemberIds([]);
      setItems(await feed.query(query));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  return <div data-testid="team-activity-feed" style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%', display: 'grid', gap: 'var(--kp-space-md)', alignContent: 'start' }}>
    <SurfaceHeader Icon={Clock3} title={t('team-activity-feed.title')} description={t('team-activity-feed.description')} />
    <p style={muted}>{t('team-activity-feed.dark-note')}</p>
    {error ? <p role="alert">{t('team-activity-feed.save-error')} {error}</p> : null}
    <section style={panel}><label htmlFor="team-activity-post" style={muted}>{t('team-activity-feed.post-label')}</label><textarea id="team-activity-post" data-testid="team-activity-post-input" aria-label={t('team-activity-feed.post-label')} value={body} onChange={(event) => { setBody(event.target.value); }} placeholder={t('team-activity-feed.post-placeholder')} style={{ width: '100%', minHeight: 82, marginTop: 6 }} /><fieldset style={{ border: 0, padding: 0, margin: '8px 0' }}><legend style={muted}>{t('team-activity-feed.mentions-label')}</legend>{members.map((member) => <label key={member.memberId} style={{ marginRight: 10 }}><input type="checkbox" data-testid={`team-activity-mention-${member.memberId}`} checked={mentionedMemberIds.includes(member.memberId)} onChange={() => { setMentionedMemberIds((current) => { return current.includes(member.memberId) ? current.filter((id) => id !== member.memberId) : [...current, member.memberId]; }); }} /> @{member.displayName}</label>)}</fieldset><SurfaceToolbar><Button data-testid="team-activity-post-save" disabled={!body.trim()} iconLeft={Send} onClick={() => { void post().catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)); }); }}>{t('team-activity-feed.post')}</Button></SurfaceToolbar></section>
    {items.length === 0 ? <EmptyState icon={Clock3} title={t('team-activity-feed.empty')} body={t('team-activity-feed.empty-body')} /> : items.map((item) => <TeamActivityCard key={item.id} item={item} feed={feed} memberId={memberId} refresh={async () => { setItems(await feed.query(query)); }} reportError={setError} />)}
  </div>;
}

function TeamActivityCard({ item, feed, memberId, refresh, reportError }: { item: TeamActivityItem; feed: TeamActivityFeed; memberId: string; refresh: () => Promise<void>; reportError: (message: string | null) => void }) {
  const { t } = useTranslation();
  const [comment, setComment] = useState('');
  const act = async (operation: () => Promise<unknown>) => {
    try { await operation(); await refresh(); } catch (reason) { reportError(reason instanceof Error ? reason.message : String(reason)); }
  };
  return <article data-testid={`team-activity-item-${item.id}`} style={panel}><strong>{item.author.displayName}</strong><p style={{ margin: '6px 0' }}>{item.body}</p>{item.mentionedMemberIds.length ? <p style={muted}>{t('team-activity-feed.mentioned')}: {item.mentionedMemberIds.join(', ')}</p> : null}<p style={muted}>{new Date(item.createdAt).toLocaleString()} · {t('team-activity-feed.comment-count', { count: item.comments.length })} · {t('team-activity-feed.reaction-count', { count: item.reactions.length })}</p><div style={{ display: 'flex', gap: 8 }}><Button size="sm" variant="secondary" iconLeft={ThumbsUp} data-testid={`team-activity-like-${item.id}`} onClick={() => { void act(() => feed.setReaction({ postId: item.id, emoji: '👍', memberId, active: true })).catch((reason: unknown) => { reportError(reason instanceof Error ? reason.message : String(reason)); }); }}>{t('team-activity-feed.like')}</Button><Button size="sm" variant="secondary" iconLeft={Heart} data-testid={`team-activity-love-${item.id}`} onClick={() => { void act(() => feed.setReaction({ postId: item.id, emoji: '❤️', memberId, active: true })).catch((reason: unknown) => { reportError(reason instanceof Error ? reason.message : String(reason)); }); }}>{t('team-activity-feed.love')}</Button></div><div style={{ marginTop: 10 }}>{item.comments.map((commentItem) => <p key={commentItem.id} data-testid={`team-activity-comment-${commentItem.id}`}><strong>{commentItem.author.displayName}</strong>: {commentItem.body}</p>)}<textarea aria-label={t('team-activity-feed.comment-label')} data-testid={`team-activity-comment-input-${item.id}`} value={comment} onChange={(event) => { setComment(event.target.value); }} placeholder={t('team-activity-feed.comment-label')} style={{ width: '100%', minHeight: 54 }} /><Button size="sm" variant="secondary" iconLeft={MessageCircle} disabled={!comment.trim()} data-testid={`team-activity-comment-save-${item.id}`} onClick={() => { const body = comment; setComment(''); void act(() => feed.addComment({ postId: item.id, body, author: { memberId, displayName: 'You' } })).catch((reason: unknown) => { reportError(reason instanceof Error ? reason.message : String(reason)); }); }}>{t('team-activity-feed.comment')}</Button></div></article>;
}
