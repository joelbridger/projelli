import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFlag } from '@/platform/flags';
import { Badge, Button } from '@/ui/kp';
import type { FirmTag, FirmTagColor, FirmTagStore } from './contract';
import { createFirmTagStore } from './tagCatalog';

const COLORS: readonly FirmTagColor[] = [
  'blue',
  'green',
  'amber',
  'red',
  'purple',
  'slate',
];

const COLOR_HEX: Record<FirmTagColor, string> = {
  blue: '#2563eb',
  green: '#15803d',
  amber: '#b45309',
  red: '#dc2626',
  purple: '#7e22ce',
  slate: '#475569',
};

const card = {
  border: '1px solid var(--kp-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)',
  padding: 'var(--kp-space-md)',
} as const;

const muted = {
  color: 'var(--kp-text-faint)',
  fontSize: 'var(--kp-font-sm)',
} as const;

function TagDot({ color }: { color: FirmTagColor }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 10,
        height: 10,
        display: 'inline-block',
        borderRadius: '50%',
        background: COLOR_HEX[color],
      }}
    />
  );
}

function TagRow({
  tag,
  onRename,
  onColor,
  onRetire,
}: {
  tag: FirmTag;
  onRename: (name: string) => void;
  onColor: (color: FirmTagColor) => void;
  onRetire: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(tag.name);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const retired = tag.status === 'retired';
  const renamed = name.trim() !== tag.name;

  return (
    <li
      data-testid={`firm-tag-row-${tag.id}`}
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
          {t('crm-tags.tag-name')}
          <input
            aria-label={t('crm-tags.tag-name-for', { name: tag.name })}
            data-testid={`firm-tag-name-${tag.id}`}
            disabled={retired}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            style={{ display: 'block', marginTop: 4, width: '100%' }}
          />
        </label>
        <span style={muted}>{t('crm-tags.tag-id', { id: tag.id })}</span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
        }}
      >
        <Badge
          data-testid={`firm-tag-status-${tag.id}`}
          variant={retired ? 'neutral' : 'success'}
        >
          {t(`crm-tags.status.${tag.status}`)}
        </Badge>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <TagDot color={tag.color} />
          <span className="sr-only">{t('crm-tags.tag-color')}</span>
          <select
            aria-label={t('crm-tags.tag-color-for', { name: tag.name })}
            data-testid={`firm-tag-color-${tag.id}`}
            disabled={retired}
            value={tag.color}
            onChange={(event) => {
              onColor(event.target.value as FirmTagColor);
            }}
          >
            {COLORS.map((color) => (
              <option key={color} value={color}>
                {t(`crm-tags.color.${color}`)}
              </option>
            ))}
          </select>
        </label>
        {renamed && !retired && (
          <Button
            size="sm"
            variant="secondary"
            data-testid={`firm-tag-save-name-${tag.id}`}
            onClick={() => {
              onRename(name);
            }}
          >
            {t('crm-tags.save-name')}
          </Button>
        )}
        {!retired &&
          (confirmRetire ? (
            <Button
              size="sm"
              variant="danger"
              data-testid={`firm-tag-confirm-retire-${tag.id}`}
              onClick={onRetire}
            >
              {t('crm-tags.confirm-retire')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              data-testid={`firm-tag-retire-${tag.id}`}
              onClick={() => {
                setConfirmRetire(true);
              }}
            >
              {t('crm-tags.retire')}
            </Button>
          ))}
      </div>
    </li>
  );
}

/** Enabled-only child. All catalog reads begin here, after the flag guard. */
export function UniversalTagsEnabledSettings({
  store = createFirmTagStore(),
}: {
  store?: FirmTagStore;
}) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState(() => store.list());
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<FirmTagColor>('blue');
  const [notice, setNotice] = useState<string | null>(null);

  const update = (
    operation: () => ReturnType<FirmTagStore['list']>,
    success: string
  ) => {
    try {
      setCatalog(operation());
      setNotice(success);
      return true;
    } catch (error: unknown) {
      setNotice(
        error instanceof Error ? error.message : t('crm-tags.save-failed')
      );
      return false;
    }
  };

  return (
    <section
      data-testid="firm-tags-settings"
      style={{ display: 'grid', gap: 'var(--kp-space-md)', maxWidth: 880 }}
    >
      <header>
        <span style={muted}>{t('crm-tags.settings-label')}</span>
        <h1 style={{ margin: '4px 0' }}>{t('crm-tags.heading')}</h1>
        <p style={muted}>{t('crm-tags.heading-copy')}</p>
      </header>
      {notice && <p role="status">{notice}</p>}
      <div style={card}>
        <div>
          <h2 style={{ margin: 0 }}>{t('crm-tags.catalog-title')}</h2>
          <p style={muted}>{t('crm-tags.catalog-copy')}</p>
        </div>
        <ul
          aria-label={t('crm-tags.catalog-title')}
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {catalog.tags.map((tag) => (
            <TagRow
              key={tag.id}
              tag={tag}
              onRename={(name) => {
                update(
                  () => store.rename(tag.id, name),
                  t('crm-tags.name-saved')
                );
              }}
              onColor={(color) => {
                update(
                  () => store.setColor(tag.id, color),
                  t('crm-tags.color-saved')
                );
              }}
              onRetire={() => {
                update(() => store.retire(tag.id), t('crm-tags.retired'));
              }}
            />
          ))}
        </ul>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              update(
                () => store.create({ name: newName, color: newColor }),
                t('crm-tags.added')
              )
            )
              setNewName('');
          }}
          style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}
        >
          <input
            aria-label={t('crm-tags.new-tag')}
            data-testid="firm-tag-new-name"
            value={newName}
            onChange={(event) => {
              setNewName(event.target.value);
            }}
            placeholder={t('crm-tags.new-tag')}
          />
          <select
            aria-label={t('crm-tags.new-tag-color')}
            data-testid="firm-tag-new-color"
            value={newColor}
            onChange={(event) => {
              setNewColor(event.target.value as FirmTagColor);
            }}
          >
            {COLORS.map((color) => (
              <option key={color} value={color}>
                {t(`crm-tags.color.${color}`)}
              </option>
            ))}
          </select>
          <Button
            type="submit"
            data-testid="firm-tag-add"
            iconLeft={Plus}
            size="sm"
          >
            {t('crm-tags.add')}
          </Button>
        </form>
      </div>
      <aside style={card}>
        <h2 style={{ marginTop: 0 }}>{t('crm-tags.references-title')}</h2>
        <p style={muted}>{t('crm-tags.references-copy')}</p>
        <Badge variant="success">{t('crm-tags.references-protected')}</Badge>
      </aside>
    </section>
  );
}

/**
 * Flag-off is deliberately inert: this guard returns before it creates a
 * store, reads persistence, subscribes, selects state, or starts an effect.
 */
export function UniversalTagsSettingsMount({
  createStore = createFirmTagStore,
}: {
  createStore?: () => FirmTagStore;
}) {
  const enabled = useFlag('universal-tags');
  if (!enabled) return null;
  return <UniversalTagsEnabledSettings store={createStore()} />;
}
