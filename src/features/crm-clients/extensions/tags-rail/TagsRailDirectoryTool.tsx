import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Tags } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  projectDirectoryResults,
  type DirectoryFeatureContext,
} from '@/features/crm-clients';
import {
  firmTagPaint,
  useFirmTagStore,
  type FirmTag,
  type FirmTagColor,
} from '@/features/crm-tags';
import { useFlag } from '@/platform/flags/router';
import { Badge, Button, Chip } from '@/ui/kp';
import {
  hasSelectedTags,
  readTagRailSelection,
  tagRailPreferences,
  type TagRailSelection,
} from './filterState';

function TagDot({ color }: { color: FirmTagColor }) {
  return (
    <span
      aria-hidden="true"
      data-tag-color={color}
      style={{
        background: firmTagPaint(color),
        borderRadius: '50%',
        display: 'inline-block',
        height: 10,
        width: 10,
      }}
    />
  );
}

function toggleTag(selectedTagIds: TagRailSelection, tagId: string): TagRailSelection {
  return selectedTagIds.includes(tagId)
    ? selectedTagIds.filter((id) => id !== tagId)
    : [...selectedTagIds, tagId];
}

function TagsRailDirectoryToolEnabled({
  context,
}: {
  context: DirectoryFeatureContext<TagRailSelection>;
}) {
  const { t } = useTranslation();
  const store = useFirmTagStore();
  const [initialSelection] = useState<TagRailSelection>(readTagRailSelection);
  const [selectedTagIds, setSelectedTagIds] = useState<TagRailSelection>(initialSelection);
  const [draftTagIds, setDraftTagIds] = useState<TagRailSelection>(initialSelection);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const initializedStatePort = useRef(false);
  const initialStore = useRef(store);

  useLayoutEffect(() => {
    if (initializedStatePort.current) return;
    initializedStatePort.current = true;
    context.featureState.set(selectedTagIds);
  }, [context.featureState, selectedTagIds]);

  useEffect(() => {
    let current = true;
    void initialStore.current.list()
      .then(() => {
        if (current) setCatalogLoaded(true);
      })
      .catch(() => {
        if (current) setCatalogUnavailable(true);
      });
    return () => {
      current = false;
    };
  }, []);

  const resolvedCatalog = store.catalog;
  const unavailable = catalogUnavailable || store.errorCode !== null;
  const active = hasSelectedTags(selectedTagIds);
  const selectedTags = resolvedCatalog.tags.filter((tag) => selectedTagIds.includes(tag.id));
  const unresolvedSelectedIds = selectedTagIds.filter(
    (id) => !resolvedCatalog.tags.some((tag) => tag.id === id),
  );
  const matchingPeople = projectDirectoryResults('person', context.records.people, context);
  const matchingHouseholds = projectDirectoryResults('household', context.records.households, context);

  const apply = () => {
    tagRailPreferences.save(draftTagIds);
    setSelectedTagIds(draftTagIds);
    context.featureState.set(draftTagIds);
  };
  const clear = () => {
    tagRailPreferences.save([]);
    setDraftTagIds([]);
    setSelectedTagIds([]);
    context.featureState.set([]);
  };

  return (
    <div data-testid="crm-directory-tags-rail">
      <Button
        aria-controls="crm-directory-tags-rail-panel"
        aria-expanded={isOpen}
        data-testid="crm-directory-tags-rail-toggle"
        iconLeft={Tags}
        onClick={() => {
          setDraftTagIds(selectedTagIds);
          setIsOpen((open) => !open);
        }}
        size="sm"
        variant="secondary"
      >
        {t('tagsRail.open', { count: selectedTagIds.length })}
      </Button>
      {active ? (
        <div aria-label={t('tagsRail.applied')} data-testid="crm-directory-tags-rail-applied">
          <span>{t('tagsRail.appliedCount', { count: selectedTagIds.length })}</span>
          {selectedTags.map((tag) => (
            <Badge key={tag.id} variant={tag.status === 'retired' ? 'warning' : 'neutral'}>
              <TagDot color={tag.color} />
              {tag.name}
              {tag.status === 'retired' ? ` ${t('tagsRail.retired')}` : ''}
            </Badge>
          ))}
          {unresolvedSelectedIds.map((id) => (
            <Badge key={id} variant="warning">
              {t('tagsRail.unavailableSelection', { id })}
            </Badge>
          ))}
          <Button
            data-testid="crm-directory-tags-rail-reset"
            onClick={clear}
            size="sm"
            variant="link"
          >
            {t('tagsRail.reset')}
          </Button>
        </div>
      ) : null}
      {isOpen ? (
        <fieldset id="crm-directory-tags-rail-panel">
          <legend>{t('tagsRail.heading')}</legend>
          {unavailable ? (
            <p aria-live="polite" data-testid="crm-directory-tags-rail-unavailable" role="alert">
              {t('tagsRail.catalogUnavailable')}
            </p>
          ) : !catalogLoaded ? (
            <p aria-live="polite" data-testid="crm-directory-tags-rail-loading" role="status">
              {t('tagsRail.loading')}
            </p>
          ) : resolvedCatalog.tags.length === 0 ? (
            <p aria-live="polite" data-testid="crm-directory-tags-rail-empty-catalog" role="status">
              {t('tagsRail.noTags')}
            </p>
          ) : (
            <div aria-label={t('tagsRail.tagList')}>
              {resolvedCatalog.tags.map((tag: FirmTag) => {
                const selected = draftTagIds.includes(tag.id);
                return (
                  <Chip
                    active={selected}
                    data-testid={`crm-directory-tags-rail-tag-${tag.id}`}
                    key={tag.id}
                    onClick={() => {
                      setDraftTagIds((current) => toggleTag(current, tag.id));
                    }}
                  >
                    <TagDot color={tag.color} />
                    {tag.name}
                    {tag.status === 'retired' ? ` ${t('tagsRail.retired')}` : ''}
                  </Chip>
                );
              })}
            </div>
          )}
          <div>
            <Button
              data-testid="crm-directory-tags-rail-apply"
              disabled={unavailable || !catalogLoaded}
              onClick={apply}
              size="sm"
            >
              {t('tagsRail.apply')}
            </Button>
            <Button
              data-testid="crm-directory-tags-rail-clear"
              onClick={clear}
              size="sm"
              variant="secondary"
            >
              {t('tagsRail.clear')}
            </Button>
          </div>
        </fieldset>
      ) : null}
      {active && matchingPeople.length + matchingHouseholds.length === 0 ? (
        <p aria-live="polite" data-testid="crm-directory-tags-rail-no-results" role="status">
          {t('tagsRail.noResults')}
        </p>
      ) : null}
    </div>
  );
}

/** Keeps all tag access in an enabled-only child, so a dark feature is inert. */
export function TagsRailDirectoryTool({
  context,
}: {
  context: DirectoryFeatureContext<TagRailSelection>;
}) {
  const enabled = useFlag('crm-tags-rail');
  if (!enabled) return null;
  return <TagsRailDirectoryToolEnabled context={context} />;
}
