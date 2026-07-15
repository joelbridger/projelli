import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { Badge, Button } from '@/ui/kp';
import {
  createContactSourceCatalogStore,
  type ContactSourceCatalogStore,
} from './catalog';
import type { ContactSourceCatalog } from './contract';

const panel = {
  border: '1px solid var(--kp-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)',
  padding: 'var(--kp-space-md)',
} as const;

const muted = {
  color: 'var(--kp-text-faint)',
  fontSize: 'var(--kp-font-sm)',
} as const;

function SourceRow({
  source,
  first,
  last,
  onRename,
  onSetActive,
  onMove,
  onRetire,
}: {
  source: ContactSourceCatalog['sources'][number];
  first: boolean;
  last: boolean;
  onRename: (label: string) => void;
  onSetActive: (active: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  onRetire: () => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(source.label);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const retired = source.status === 'retired';
  const renamed = label.trim() !== source.label;

  return (
    <li
      data-testid={`contact-source-row-${source.id}`}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 12,
        alignItems: 'center',
        borderTop: '1px solid var(--kp-border)',
        padding: '12px 0',
      }}
    >
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={muted}>
          {t('contact-sources.source-name')}
          <input
            aria-label={t('contact-sources.source-name-for', {
              name: source.label,
            })}
            data-testid={`contact-source-label-${source.id}`}
            disabled={retired}
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
            }}
            style={{ display: 'block', marginTop: 4, width: '100%' }}
          />
        </label>
        <span style={muted}>
          {t('contact-sources.source-id', { id: source.id })}
        </span>
        {source.historicalLabels.length > 1 && (
          <span style={muted}>
            {t('contact-sources.previous-names', {
              names: source.historicalLabels.slice(0, -1).join(', '),
            })}
          </span>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          gap: 6,
        }}
      >
        <Badge
          data-testid={`contact-source-status-${source.id}`}
          variant={source.status === 'active' ? 'success' : 'neutral'}
        >
          {t(`contact-sources.status.${source.status}`)}
        </Badge>
        {renamed && !retired && (
          <Button
            size="sm"
            variant="secondary"
            data-testid={`contact-source-save-${source.id}`}
            onClick={() => {
              onRename(label);
            }}
          >
            {t('contact-sources.save-name')}
          </Button>
        )}
        {!retired && (
          <Button
            size="sm"
            variant="secondary"
            data-testid={`contact-source-toggle-${source.id}`}
            onClick={() => {
              onSetActive(source.status !== 'active');
            }}
          >
            {source.status === 'active'
              ? t('contact-sources.deactivate')
              : t('contact-sources.activate')}
          </Button>
        )}
        <Button
          aria-label={t('contact-sources.move-up', { name: source.label })}
          disabled={first}
          size="sm"
          variant="secondary"
          iconLeft={ArrowUp}
          onClick={() => {
            onMove(-1);
          }}
        />
        <Button
          aria-label={t('contact-sources.move-down', { name: source.label })}
          disabled={last}
          size="sm"
          variant="secondary"
          iconLeft={ArrowDown}
          onClick={() => {
            onMove(1);
          }}
        />
        {!retired &&
          (confirmRetire ? (
            <Button
              size="sm"
              variant="danger"
              data-testid={`contact-source-confirm-retire-${source.id}`}
              onClick={onRetire}
            >
              {t('contact-sources.confirm-retire')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              data-testid={`contact-source-retire-${source.id}`}
              onClick={() => {
                setConfirmRetire(true);
              }}
            >
              {t('contact-sources.retire')}
            </Button>
          ))}
      </div>
    </li>
  );
}

export function ContactSourcesSettings({
  store = createContactSourceCatalogStore(),
}: {
  store?: ContactSourceCatalogStore;
}) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<ContactSourceCatalog>(() =>
    store.load()
  );
  const [newSource, setNewSource] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const update = (
    operation: () => ContactSourceCatalog,
    success: string
  ): boolean => {
    try {
      setCatalog(operation());
      setNotice(success);
      return true;
    } catch (error: unknown) {
      setNotice(
        error instanceof Error
          ? error.message
          : t('contact-sources.save-failed')
      );
      return false;
    }
  };

  const move = (id: string, direction: -1 | 1) => {
    const index = catalog.sources.findIndex((source) => source.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= catalog.sources.length)
      return;
    const ids = catalog.sources.map((source) => source.id);
    const currentId = ids[index];
    const nextId = ids[nextIndex];
    if (currentId === undefined || nextId === undefined) return;
    ids[index] = nextId;
    ids[nextIndex] = currentId;
    update(() => store.reorder(ids), t('contact-sources.order-saved'));
  };

  return (
    <section
      data-testid="contact-sources-settings"
      style={{ display: 'grid', gap: 'var(--kp-space-md)', maxWidth: 880 }}
    >
      <header>
        <span style={muted}>{t('contact-sources.settings-label')}</span>
        <h1 style={{ margin: '4px 0' }}>{t('contact-sources.heading')}</h1>
        <p style={muted}>{t('contact-sources.heading-copy')}</p>
      </header>
      {notice && <p role="status">{notice}</p>}
      <div style={panel}>
        <div>
          <h2 style={{ margin: 0 }}>{t('contact-sources.catalog-title')}</h2>
          <p style={muted}>{t('contact-sources.catalog-copy')}</p>
        </div>
        <ul
          aria-label={t('contact-sources.catalog-title')}
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {catalog.sources.map((source, index) => (
            <SourceRow
              key={source.id}
              source={source}
              first={index === 0}
              last={index === catalog.sources.length - 1}
              onRename={(label) => {
                update(
                  () => store.rename(source.id, label),
                  t('contact-sources.name-saved')
                );
              }}
              onSetActive={(active) => {
                update(
                  () => store.setActive(source.id, active),
                  active
                    ? t('contact-sources.activated')
                    : t('contact-sources.deactivated')
                );
              }}
              onMove={(direction) => {
                move(source.id, direction);
              }}
              onRetire={() => {
                update(
                  () => store.retire(source.id),
                  t('contact-sources.retired')
                );
              }}
            />
          ))}
        </ul>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (update(() => store.add(newSource), t('contact-sources.added')))
              setNewSource('');
          }}
          style={{ display: 'flex', gap: 8, marginTop: 12 }}
        >
          <input
            aria-label={t('contact-sources.new-source')}
            data-testid="contact-source-new"
            value={newSource}
            onChange={(event) => {
              setNewSource(event.target.value);
            }}
            placeholder={t('contact-sources.new-source')}
          />
          <Button
            type="submit"
            data-testid="contact-source-add"
            iconLeft={Plus}
            size="sm"
          >
            {t('contact-sources.add')}
          </Button>
        </form>
      </div>
      <aside style={panel}>
        <h2 style={{ marginTop: 0 }}>{t('contact-sources.history-title')}</h2>
        <p style={muted}>{t('contact-sources.history-copy')}</p>
        <Badge variant="success">
          {t('contact-sources.history-protected')}
        </Badge>
      </aside>
    </section>
  );
}
