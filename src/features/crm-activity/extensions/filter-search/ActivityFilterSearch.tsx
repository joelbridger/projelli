import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchField } from '@/ui/kp';
import { ownClientsEnforcementActive } from '@/features/crm-permissions';
import type { ActivityToolContext } from '@/features/crm-activity/team-feed';
import {
  activityAuthors,
  activityFilterSearchState,
  defaultActivityFilterSearchState,
  type ActivityFilterSearchState,
} from './selectors';

function setState(
  context: ActivityToolContext<ActivityFilterSearchState>,
  change: {
    readonly query?: string;
    readonly kind?: ActivityFilterSearchState['kind'];
    readonly authorId?: string;
  },
): void {
  const current = activityFilterSearchState(context.state.get());
  context.state.set({
    query: change.query ?? current.query,
    kind: change.kind ?? current.kind,
    authorId: change.authorId ?? current.authorId,
  });
}

/** Only mounted after the descriptor has checked this feature's dark flag. */
export function ActivityFilterSearch({
  context,
}: {
  context: ActivityToolContext<ActivityFilterSearchState>;
}) {
  const { t } = useTranslation();
  const state = activityFilterSearchState(context.state.get());
  const [nativeVisibilityActive, setNativeVisibilityActive] = useState(false);

  useEffect(() => {
    let current = true;
    void ownClientsEnforcementActive().then((active) => {
      if (current) setNativeVisibilityActive(active);
    }).catch(() => {
      if (current) setNativeVisibilityActive(false);
    });
    return () => { current = false; };
  }, []);

  const authors = activityAuthors(context.sourceItems);
  return <div data-testid="activity-filter-search" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--kp-space-sm)', alignItems: 'center' }}>
    <SearchField
      data-testid="activity-filter-search-input"
      aria-label={t('activity-filter-search.search-label')}
      value={state.query}
      onChange={(query) => { setState(context, { query }); }}
      onClear={() => { setState(context, { query: '' }); }}
      placeholder={t('activity-filter-search.search-placeholder')}
      style={{ minWidth: 220, flex: '1 1 240px' }}
    />
    <select
      data-testid="activity-filter-search-kind"
      aria-label={t('activity-filter-search.kind-label')}
      className="kp-chip kp-chip--sm"
      value={state.kind}
      onChange={(event) => { setState(context, { kind: event.target.value as ActivityFilterSearchState['kind'] }); }}
    >
      <option value="all">{t('activity-filter-search.kind.all')}</option>
      <option value="mentions">{t('activity-filter-search.kind.mentions')}</option>
      <option value="discussions">{t('activity-filter-search.kind.discussions')}</option>
      <option value="reactions">{t('activity-filter-search.kind.reactions')}</option>
    </select>
    <select
      data-testid="activity-filter-search-author"
      aria-label={t('activity-filter-search.author-label')}
      className="kp-chip kp-chip--sm"
      value={state.authorId}
      onChange={(event) => { setState(context, { authorId: event.target.value }); }}
    >
      <option value="">{t('activity-filter-search.author.all')}</option>
      {authors.map((author) => <option key={author.id} value={author.id}>{author.label}</option>)}
    </select>
    {(state.query || state.kind !== 'all' || state.authorId) ? <button
      type="button"
      className="kp-button kp-button--ghost kp-button--sm"
      data-testid="activity-filter-search-reset"
      onClick={() => { context.state.set(defaultActivityFilterSearchState); }}
    >{t('activity-filter-search.reset')}</button> : null}
    {nativeVisibilityActive ? <span data-testid="activity-filter-search-native-visibility" hidden /> : null}
  </div>;
}

export function ActivityFilterSearchEmpty({
  isFiltered,
  onReset,
}: {
  isFiltered: boolean;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return <div data-testid="activity-filter-search-empty" role="status">
    <p>{t(isFiltered ? 'activity-filter-search.no-results' : 'team-activity-feed.empty')}</p>
    <button type="button" className="kp-button kp-button--secondary kp-button--sm" onClick={onReset}>
      {t('activity-filter-search.reset')}
    </button>
  </div>;
}
