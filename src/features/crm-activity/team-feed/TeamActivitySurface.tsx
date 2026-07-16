import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3 } from 'lucide-react';
import { EmptyState, SurfaceToolbar } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { useFlag } from '@/platform/flags';
import { useFlagRegistryVersion } from '@/platform/flags/router';
import { CrmActivitySurface } from '@/features/crm-activity';
import { TeamActivityFeedProvider } from './TeamActivityFeedProvider';
import { useTeamActivityFeed } from './useTeamActivityFeed';
import type { TeamActivityItem } from './contracts';
import {
  activityToolMountContext,
  defaultActivityToolComposition,
  enabledActivityTools,
  projectActivityItems,
  type ActivityToolComposition,
  type ActivityToolState,
  type ActivityToolStateValue,
} from './activityToolRegistry';

const muted = { color: 'var(--kp-text-faint)', fontSize: 'var(--kp-font-sm)' } as const;
const panel = { border: '1px solid var(--kp-border)', borderRadius: 'var(--radius-lg)', background: 'var(--kp-surface)', padding: 'var(--kp-space-md)' } as const;

/**
 * The off path only reads its flag and renders the exact legacy screen. All
 * native reads and relay setup remain inside the enabled child.
 */
export function TeamActivitySurface({
  composition = defaultActivityToolComposition,
}: { composition?: ActivityToolComposition } = {}) {
  const enabled = useFlag('team-activity-feed');
  if (!enabled) return <CrmActivitySurface />;
  return <TeamActivityFeedProvider><TeamActivitySurfaceEnabled composition={composition} /></TeamActivityFeedProvider>;
}

function TeamActivitySurfaceEnabled({ composition }: { composition: ActivityToolComposition }) {
  const { t } = useTranslation();
  const feed = useTeamActivityFeed();
  useFlagRegistryVersion();
  const [items, setItems] = useState<readonly TeamActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toolState, setToolState] = useState<ReadonlyMap<string, ActivityToolStateValue>>(new Map());
  const stateFor = useCallback(<Value extends ActivityToolStateValue>(id: string): ActivityToolState<Value> => ({
    get: () => toolState.get(id) as Value | undefined,
    set: (value) => {
      setToolState((previous) => previous.get(id) === value
        ? previous
        : new Map(previous).set(id, value));
    },
  }), [toolState]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void feed.query().then((next) => {
        if (!cancelled) {
          setItems(next);
          setError(null);
        }
      }).catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    };
    refresh();
    const unsubscribe = feed.subscribe(refresh);
    return () => { cancelled = true; unsubscribe(); };
  }, [feed]);

  const tools = enabledActivityTools(composition);
  const visibleItems = projectActivityItems(items, tools, stateFor);
  const emptyResultTool = items.length > 0 && visibleItems.length === 0
    ? tools.find((descriptor) => descriptor.renderEmptyResult !== undefined)
    : undefined;

  return <div data-testid="team-activity-feed" style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%', display: 'grid', gap: 'var(--kp-space-md)', alignContent: 'start' }}>
    <SurfaceHeader Icon={Clock3} title={t('team-activity-feed.title')} description={t('team-activity-feed.description')} />
    <p style={muted}>{t('team-activity-feed.dark-note')}</p>
    <p data-testid="team-activity-read-only" style={muted}>{t('team-activity-feed.identity-pending')}</p>
    {tools.length > 0
      ? <SurfaceToolbar data-testid="team-activity-tools">{tools.map((descriptor) => <span key={descriptor.id}>{descriptor.mount(activityToolMountContext(descriptor, items, visibleItems, stateFor))}</span>)}</SurfaceToolbar>
      : null}
    {error ? <p role="alert">{t('team-activity-feed.load-error')} {error}</p> : null}
    {emptyResultTool?.renderEmptyResult
      ? emptyResultTool.renderEmptyResult(activityToolMountContext(emptyResultTool, items, visibleItems, stateFor))
      : visibleItems.length === 0
      ? <EmptyState icon={Clock3} title={t('team-activity-feed.empty')} body={t('team-activity-feed.empty-body')} />
      : visibleItems.map((item) => <TeamActivityCard key={item.id} item={item} />)}
  </div>;
}

function TeamActivityCard({ item }: { item: TeamActivityItem }) {
  const { t } = useTranslation();
  return <article data-testid={`team-activity-item-${item.id}`} style={panel}>
    <strong>{item.author.displayName}</strong>
    <span style={muted}> {t('team-activity-feed.untrusted-author')}</span>
    <p style={{ margin: '6px 0' }}>{item.body}</p>
    {item.mentionedMemberIds.length
      ? <p style={muted}>{t('team-activity-feed.mentioned')}: {item.mentionedMemberIds.join(', ')}</p>
      : null}
    <p style={muted}>
      {new Date(item.createdAt).toLocaleString()} · {t('team-activity-feed.comment-count', { count: item.comments.length })} · {t('team-activity-feed.reaction-count', { count: item.reactions.length })}
    </p>
    {item.comments.map((comment) => <p key={comment.id} data-testid={`team-activity-comment-${comment.id}`}>
      <strong>{comment.author.displayName}</strong> <span style={muted}>{t('team-activity-feed.untrusted-author')}</span>: {comment.body}
    </p>)}
  </article>;
}
