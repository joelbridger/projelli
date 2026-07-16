import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isEnabled } from '@/platform/flags';
import { Badge, Button } from '@/ui/kp';
import type {
  FirmTag,
  FirmTagColor,
  FirmTagErrorCode,
  FirmTagStore,
} from './contract';
import { FirmTagError } from './contract';
import { useFirmTagStore } from './useFirmTagStore';

const COLORS = [
  { value: '#2563eb', label: 'blue' },
  { value: '#15803d', label: 'green' },
  { value: '#b45309', label: 'amber' },
  { value: '#dc2626', label: 'red' },
  { value: '#7e22ce', label: 'purple' },
  { value: '#475569', label: 'slate' },
] as const satisfies readonly { value: FirmTagColor; label: string }[];

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
        background: color,
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
  const [draft, setDraft] = useState({ value: tag.name, sourceName: tag.name });
  const [confirmRetire, setConfirmRetire] = useState(false);
  const retired = tag.status === 'retired';
  // A remote canonical update wins over an unsaved draft based on an older
  // value. This avoids a local React copy masking a change from another CRM
  // screen, without a synchronizing effect that creates a second state loop.
  const name = draft.sourceName === tag.name ? draft.value : tag.name;
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
              setDraft({ value: event.target.value, sourceName: tag.name });
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
            {!COLORS.some((color) => color.value === tag.color) && (
              <option value={tag.color}>{tag.color}</option>
            )}
            {COLORS.map((color) => (
              <option key={color.value} value={color.value}>
                {t(`crm-tags.color.${color.label}`)}
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
  store,
}: {
  store: FirmTagStore;
}) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<FirmTagColor>('#2563eb');
  const [notice, setNotice] = useState<string | null>(null);

  const failureMessage = (error: unknown): string => {
    if (!(error instanceof FirmTagError)) return t('crm-tags.error.persistence_failed');
    const key: FirmTagErrorCode = error.code;
    return t(`crm-tags.error.${key}`);
  };

  const update = async (
    operation: () => Promise<FirmTagCatalog>,
    success: string
  ): Promise<boolean> => {
    try {
      await operation();
      setNotice(success);
      return true;
    } catch (error: unknown) {
      setNotice(failureMessage(error));
      return false;
    }
  };

  const fireUpdate = (
    operation: () => Promise<FirmTagCatalog>,
    success: string
  ) => {
    void update(operation, success).catch((error: unknown) => {
      setNotice(failureMessage(error));
    });
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
      {store.errorCode && (
        <p role="alert">{t(`crm-tags.error.${store.errorCode}`)}</p>
      )}
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
          {store.catalog.tags.map((tag) => (
            <TagRow
              key={tag.id}
              tag={tag}
              onRename={(name) => {
                fireUpdate(
                  () => store.rename(tag.id, name),
                  t('crm-tags.name-saved')
                );
              }}
              onColor={(color) => {
                fireUpdate(
                  () => store.setColor(tag.id, color),
                  t('crm-tags.color-saved')
                );
              }}
              onRetire={() => {
                fireUpdate(() => store.retire(tag.id), t('crm-tags.retired'));
              }}
            />
          ))}
        </ul>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void update(
              () => store.create({ name: newName, color: newColor }),
              t('crm-tags.added')
            )
              .then((saved) => {
                if (saved) setNewName('');
              })
              .catch((error: unknown) => {
                setNotice(
                  failureMessage(error)
                );
              });
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
              setNewColor(event.target.value);
            }}
          >
            {COLORS.map((color) => (
              <option key={color.value} value={color.value}>
                {t(`crm-tags.color.${color.label}`)}
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
function UniversalTagsCanonicalSettings() {
  return <UniversalTagsEnabledSettings store={useFirmTagStore()} />;
}

export function UniversalTagsSettingsMount({
  createStore,
}: {
  createStore?: () => FirmTagStore;
}) {
  if (!isEnabled('universal-tags')) return null;
  return createStore ? (
    <UniversalTagsEnabledSettings store={createStore()} />
  ) : (
    <UniversalTagsCanonicalSettings />
  );
}
