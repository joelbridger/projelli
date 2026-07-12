/* eslint-disable lantern-i18n/no-hardcoded-string -- frozen CRM activity copy */
import { useMemo, useState } from 'react';
import { Heart, PartyPopper, ThumbsUp } from 'lucide-react';
import { Button } from '@/ui/kp';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

export const ACTIVITY_REACTIONS = [
  { emoji: '👍', label: 'Like', Icon: ThumbsUp },
  { emoji: '❤️', label: 'Love', Icon: Heart },
  { emoji: '🎉', label: 'Celebrate', Icon: PartyPopper },
] as const;

export type ActivityAuthor = { userId: string; displayName: string };

export type ActivityComment = LiveCrmRecord & {
  kind: 'activityComment';
  activityId: string;
  parentCommentId?: string;
  body: string;
  author: ActivityAuthor;
  visibility: 'firm-wide';
  createdAt: string;
};

export type ActivityReaction = LiveCrmRecord & {
  kind: 'activityReaction';
  activityId: string;
  emoji: string;
  userId: string;
  createdAt: string;
  removedAt?: string;
};

export function commentsForActivity(records: readonly LiveCrmRecord[], activityId: string): readonly ActivityComment[] {
  return records
    .filter((record): record is ActivityComment => record.kind === 'activityComment' && record['activityId'] === activityId && typeof record['body'] === 'string' && typeof record['createdAt'] === 'string')
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

export function reactionsForActivity(records: readonly LiveCrmRecord[], activityId: string): readonly ActivityReaction[] {
  return records.filter((record): record is ActivityReaction => record.kind === 'activityReaction' && record['activityId'] === activityId && typeof record['emoji'] === 'string' && typeof record['userId'] === 'string' && typeof record['createdAt'] === 'string' && !record['removedAt']);
}

function safeIdPart(value: string) {
  return Array.from(value).map((character) => /[a-zA-Z0-9:_-]/.test(character) ? character : character.codePointAt(0)?.toString(16) ?? 'x').join('_');
}

export function activityReactionId(activityId: string, emoji: string, userId: string) {
  return `activity-reaction:${safeIdPart(activityId)}:${safeIdPart(emoji)}:${safeIdPart(userId)}`;
}

export function newActivityComment(activity: LiveCrmRecord, body: string, author: ActivityAuthor, parentCommentId?: string): ActivityComment {
  const now = new Date().toISOString();
  return {
    id: `activity-comment:${crypto.randomUUID()}`,
    kind: 'activityComment',
    matterId: activity.matterId ?? 'firm_home',
    activityId: activity.id,
    ...(parentCommentId ? { parentCommentId } : {}),
    ...(typeof activity['householdId'] === 'string' ? { householdId: activity['householdId'] } : {}),
    body: body.trim(),
    author,
    visibility: 'firm-wide',
    createdAt: now,
    updatedAt: now,
  };
}

function displayName(comment: ActivityComment) {
  return comment.author?.displayName?.trim() || 'A firm member';
}

function CommentLine({ comment, comments, onReply }: { comment: ActivityComment; comments: readonly ActivityComment[]; onReply?: (parentCommentId: string) => void }) {
  const replies = comments.filter((candidate) => candidate.parentCommentId === comment.id);
  return <div data-testid={`crm-activity-comment-${comment.id}`} style={{ display: 'grid', gap: 6, padding: '10px 0', borderTop: '1px solid var(--kp-border)' }}>
    <div><strong>{displayName(comment)}</strong><span style={{ color: 'var(--kp-text-faint)', fontSize: 'var(--kp-font-sm)' }}> · Firm-wide</span></div>
    <div>{comment.body}</div>
    {onReply ? <Button size="sm" variant="secondary" data-testid={`crm-activity-comment-reply-${comment.id}`} onClick={() => onReply(comment.id)}>Reply</Button> : null}
    {replies.length ? <div style={{ display: 'grid', gap: 6, marginLeft: 20, paddingLeft: 12, borderLeft: '2px solid var(--kp-border)' }}>{replies.map((reply) => <CommentLine key={reply.id} comment={reply} comments={comments} {...(onReply ? { onReply } : {})} />)}</div> : null}
  </div>;
}

export function ActivityThread({
  activity,
  records,
  currentUser,
  onSave,
  readOnly = false,
}: {
  activity: LiveCrmRecord;
  records: readonly LiveCrmRecord[];
  currentUser?: ActivityAuthor;
  onSave?: (record: LiveCrmRecord) => Promise<unknown> | unknown;
  readOnly?: boolean;
}) {
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const comments = useMemo(() => commentsForActivity(records, activity.id), [activity.id, records]);
  const reactions = useMemo(() => reactionsForActivity(records, activity.id), [activity.id, records]);
  const roots = comments.filter((comment) => !comment.parentCommentId || !comments.some((candidate) => candidate.id === comment.parentCommentId));
  const submit = async () => {
    if (!onSave || !currentUser || !body.trim()) return;
    setSaving(true);
    try {
      await onSave(newActivityComment(activity, body, currentUser, replyTo));
      setBody('');
      setReplyTo(undefined);
    } finally { setSaving(false); }
  };
  const toggleReaction = async (emoji: string) => {
    if (!onSave || !currentUser) return;
    const existing = reactions.find((reaction) => reaction.emoji === emoji && reaction.userId === currentUser.userId);
    const now = new Date().toISOString();
    await onSave({
      id: activityReactionId(activity.id, emoji, currentUser.userId),
      kind: 'activityReaction',
      matterId: activity.matterId ?? 'firm_home',
      activityId: activity.id,
      ...(typeof activity['householdId'] === 'string' ? { householdId: activity['householdId'] } : {}),
      emoji,
      userId: currentUser.userId,
      ...(existing ? { createdAt: existing.createdAt, removedAt: now } : { createdAt: now }),
      updatedAt: now,
    });
  };
  return <section data-testid={`crm-activity-thread-${activity.id}`} style={{ display: 'grid', gap: 8, marginTop: 10 }}>
    <div aria-label="Reactions" data-testid={`crm-activity-reactions-${activity.id}`} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {ACTIVITY_REACTIONS.map(({ emoji, label, Icon }) => {
        const count = reactions.filter((reaction) => reaction.emoji === emoji).length;
        const mine = Boolean(currentUser && reactions.some((reaction) => reaction.emoji === emoji && reaction.userId === currentUser.userId));
        return <Button key={emoji} size="sm" variant={mine ? 'primary' : 'secondary'} data-testid={`crm-activity-reaction-${activity.id}-${emoji}`} aria-label={`${mine ? 'Remove' : 'Add'} ${label} reaction`} disabled={readOnly || !onSave || !currentUser} iconLeft={Icon} onClick={() => { void toggleReaction(emoji); }}>{emoji} {count || label}</Button>;
      })}
    </div>
    {comments.length ? <div data-testid={`crm-activity-comments-${activity.id}`}><strong>{comments.length === 1 ? '1 comment' : `${String(comments.length)} comments`}</strong>{roots.map((comment) => <CommentLine key={comment.id} comment={comment} comments={comments} {...(!readOnly ? { onReply: setReplyTo } : {})} />)}</div> : <p data-testid={`crm-activity-comments-empty-${activity.id}`} style={{ color: 'var(--kp-text-faint)', fontSize: 'var(--kp-font-sm)', margin: 0 }}>No comments yet. Share context that will help your firm.</p>}
    {!readOnly ? <div style={{ display: 'grid', gap: 6 }}>
      {replyTo ? <div style={{ color: 'var(--kp-text-faint)', fontSize: 'var(--kp-font-sm)' }}>Replying in this thread <button type="button" onClick={() => setReplyTo(undefined)} style={{ border: 0, background: 'transparent', color: 'var(--kp-assured)', cursor: 'pointer', padding: 0 }}>Cancel</button></div> : null}
      <textarea data-testid={`crm-activity-comment-input-${activity.id}`} aria-label="Add a comment" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Add a comment for your firm" style={{ width: '100%', minHeight: 68 }} />
      <div><Button size="sm" data-testid={`crm-activity-comment-save-${activity.id}`} disabled={!body.trim() || saving} onClick={() => { void submit(); }}>{saving ? 'Saving…' : replyTo ? 'Post reply' : 'Post comment'}</Button></div>
    </div> : null}
  </section>;
}
