import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Archive, Plus, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/kp';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type {
  CustomFieldAppliesTo,
  CustomFieldKind,
  FieldCatalog,
  FieldCatalogDraft,
  FieldCatalogField,
} from './fieldCatalog';
import { defineField, renameField, reorderFields, retireField } from './fieldCatalog';
import { createLiveFieldCatalogPersistence } from './fieldCatalogPersistence';

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

const KINDS: readonly CustomFieldKind[] = [
  'text',
  'number',
  'money',
  'date',
  'boolean',
  'select',
  'multi-select',
];
const TARGETS: readonly CustomFieldAppliesTo[] = ['household', 'person'];

function makeId(): string {
  return `custom-field:${crypto.randomUUID()}`;
}

function NewFieldForm({
  onCreate,
  onCancel,
}: {
  onCreate: (draft: FieldCatalogDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CustomFieldKind>('text');
  const [options, setOptions] = useState('');
  const [appliesTo, setAppliesTo] = useState<CustomFieldAppliesTo[]>([
    'household',
  ]);
  const [error, setError] = useState<string | null>(null);
  const needsOptions = kind === 'select' || kind === 'multi-select';

  const submit = async () => {
    try {
      setError(null);
      await onCreate({
        name,
        kind,
        ...(needsOptions
          ? {
              options: options
                .split(',')
                .map((option) => option.trim())
                .filter(Boolean),
            }
          : {}),
        appliesTo,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('custom-fields.save-failed'));
    }
  };
  const runSubmit = () => {
    void submit().catch((reason: unknown) => {
      setError(
        reason instanceof Error ? reason.message : t('custom-fields.save-failed')
      );
    });
  };

  return (
    <section data-testid="custom-fields-new-form" style={{ ...card, marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>{t('custom-fields.new-title')}</h3>
      <label style={{ display: 'block', marginBottom: 10 }}>
        {t('custom-fields.name-label')}
        <input
          data-testid="custom-fields-name"
          value={name}
          onChange={(event) => { setName(event.target.value); }}
        />
      </label>
      <label style={{ display: 'block', marginBottom: 10 }}>
        {t('custom-fields.kind-label')}
        <select
          data-testid="custom-fields-kind"
          value={kind}
          onChange={(event) => { setKind(event.target.value as CustomFieldKind); }}
        >
          {KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`custom-fields.kind.${value}`)}
            </option>
          ))}
        </select>
      </label>
      {needsOptions && (
        <label style={{ display: 'block', marginBottom: 10 }}>
          {t('custom-fields.options-label')}
          <input
            data-testid="custom-fields-options"
            value={options}
            onChange={(event) => { setOptions(event.target.value); }}
            placeholder={t('custom-fields.options-placeholder')}
          />
        </label>
      )}
      <fieldset style={{ border: 0, margin: '0 0 10px', padding: 0 }}>
        <legend>{t('custom-fields.applies-to-label')}</legend>
        {TARGETS.map((target) => (
          <label key={target} style={{ display: 'inline-flex', gap: 5, marginRight: 14 }}>
            <input
              data-testid={`custom-fields-applies-${target}`}
              type="checkbox"
              checked={appliesTo.includes(target)}
              onChange={(event) => {
                setAppliesTo((current) =>
                  event.target.checked
                    ? [...current, target]
                    : current.filter((item) => item !== target)
                );
              }}
            />
            {t(`custom-fields.applies-to.${target}`)}
          </label>
        ))}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          data-testid="custom-fields-create"
          onClick={runSubmit}
        >
          {t('custom-fields.create')}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t('custom-fields.cancel')}
        </Button>
      </div>
    </section>
  );
}

function FieldRow({
  field,
  position,
  total,
  onRename,
  onReorder,
  onRetire,
}: {
  field: FieldCatalogField;
  position: number;
  total: number;
  onRename: (name: string) => Promise<void>;
  onReorder: (direction: -1 | 1) => Promise<void>;
  onRetire: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(field.name);
  const [error, setError] = useState<string | null>(null);
  const targetNames = field.appliesTo.map((target) =>
    t(`custom-fields.applies-to.${target}`)
  );

  const saveRename = async () => {
    try {
      setError(null);
      await onRename(name);
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('custom-fields.save-failed'));
    }
  };
  const run = (operation: () => Promise<void>) => {
    void operation().catch((reason: unknown) => {
      setError(
        reason instanceof Error ? reason.message : t('custom-fields.save-failed')
      );
    });
  };

  return (
    <article
      data-testid={`custom-fields-row-${field.id}`}
      style={{ borderTop: '1px solid var(--kp-border)', padding: '12px 0' }}
    >
      {editing ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            aria-label={t('custom-fields.rename-label')}
            data-testid={`custom-fields-rename-input-${field.id}`}
            value={name}
            onChange={(event) => { setName(event.target.value); }}
          />
          <Button
            size="sm"
            onClick={() => {
              run(saveRename);
            }}
          >
            {t('custom-fields.save')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { setEditing(false); }}>
            {t('custom-fields.cancel')}
          </Button>
        </div>
      ) : (
        <>
          <strong>{field.name}</strong>
          <p style={{ ...muted, margin: '4px 0 0' }}>
            {t(`custom-fields.kind.${field.kind}`)} · {targetNames.join(', ')}
            {field.options?.length
              ? ` · ${field.options.join(', ')}`
              : ''}
          </p>
        </>
      )}
      {field.retired ? (
        <p data-testid={`custom-fields-retired-${field.id}`} style={{ ...muted, marginBottom: 0 }}>
          {t('custom-fields.retired')}
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
          {!editing && (
            <Button
              size="sm"
              variant="secondary"
              data-testid={`custom-fields-rename-${field.id}`}
              iconLeft={Pencil}
              onClick={() => { setEditing(true); }}
            >
              {t('custom-fields.rename')}
            </Button>
          )}
          <Button
            aria-label={t('custom-fields.move-up')}
            size="sm"
            variant="secondary"
            disabled={position === 0}
            iconLeft={ArrowUp}
            onClick={() => {
              run(() => onReorder(-1));
            }}
          >
            {t('custom-fields.move-up')}
          </Button>
          <Button
            aria-label={t('custom-fields.move-down')}
            size="sm"
            variant="secondary"
            disabled={position === total - 1}
            iconLeft={ArrowDown}
            onClick={() => {
              run(() => onReorder(1));
            }}
          >
            {t('custom-fields.move-down')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            data-testid={`custom-fields-retire-${field.id}`}
            iconLeft={Archive}
            onClick={() => {
              run(onRetire);
            }}
          >
            {t('custom-fields.retire')}
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}

export function CustomFieldsSettings() {
  const { t } = useTranslation();
  const { records, save, error: liveError } = useLiveCrmRecords();
  const persistence = useMemo(
    () => createLiveFieldCatalogPersistence({ records, save }),
    [records, save]
  );
  const [catalog, setCatalog] = useState<FieldCatalog>({ fields: [] });
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void persistence
      .load()
      .then((next) => {
        if (active) setCatalog(next);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : t('custom-fields.load-failed')
          );
      });
    return () => {
      active = false;
    };
  }, [persistence, t]);

  const persist = async (next: FieldCatalog) => {
    setError(null);
    await persistence.save(next);
    setCatalog(next);
    setNotice(t('custom-fields.saved'));
  };

  const move = async (field: FieldCatalogField, direction: -1 | 1) => {
    const index = catalog.fields.findIndex((item) => item.id === field.id);
    const target = index + direction;
    if (target < 0 || target >= catalog.fields.length) return;
    const ids = catalog.fields.map((item) => item.id);
    const fieldId = ids[index];
    const targetId = ids[target];
    if (fieldId === undefined || targetId === undefined) return;
    ids[index] = targetId;
    ids[target] = fieldId;
    await persist(reorderFields(catalog, ids));
  };

  return (
    <section
      data-testid="custom-fields-settings"
      style={{ display: 'grid', gap: 'var(--kp-space-md)', maxWidth: 880 }}
    >
      <header>
        <span style={muted}>{t('custom-fields.settings-label')}</span>
        <h1 style={{ margin: '4px 0' }}>{t('custom-fields.heading')}</h1>
        <p style={muted}>{t('custom-fields.heading-copy')}</p>
      </header>
      {liveError && <p role="alert">{liveError}</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>{t('custom-fields.catalog-title')}</h2>
            <p style={{ ...muted, marginBottom: 0 }}>{t('custom-fields.catalog-copy')}</p>
          </div>
          <Button
            data-testid="custom-fields-open-create"
            iconLeft={Plus}
            onClick={() => { setCreating(true); }}
          >
            {t('custom-fields.add')}
          </Button>
        </div>
        {creating && (
          <NewFieldForm
            onCancel={() => { setCreating(false); }}
            onCreate={async (draft) => {
              await persist(defineField(catalog, makeId(), draft));
              setCreating(false);
            }}
          />
        )}
        {catalog.fields.length === 0 && !creating ? (
          <p data-testid="custom-fields-empty" style={{ ...muted, marginBottom: 0 }}>
            {t('custom-fields.empty')}
          </p>
        ) : (
          <div>
            {catalog.fields.map((field, index) => (
              <FieldRow
                key={field.id}
                field={field}
                position={index}
                total={catalog.fields.length}
                onRename={(name) => persist(renameField(catalog, field.id, name))}
                onReorder={(direction) => move(field, direction)}
                onRetire={() => persist(retireField(catalog, field.id))}
              />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
