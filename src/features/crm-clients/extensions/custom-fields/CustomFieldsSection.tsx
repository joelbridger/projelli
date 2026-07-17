import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createLiveFieldCatalogPersistence,
  type CustomFieldKind,
  type FieldCatalog,
  type FieldCatalogField,
} from '@/features/crm-firm';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { useFlag } from '@/platform/flags';
import { Button, Card } from '@/ui/kp';
import type { HouseholdRecordShellContext } from '../../recordRegistry';
import {
  readCustomFieldValues,
  withCustomFieldValues,
} from './customFieldValues';
import type { CustomFieldValue, CustomFieldValues } from './customFieldValues';

type SectionProps = Pick<
  HouseholdRecordShellContext,
  'household' | 'onSaveHousehold'
>;

function visibleHouseholdFields(
  catalog: FieldCatalog
): readonly FieldCatalogField[] {
  return catalog.fields.filter(
    (field) => !field.retired && field.appliesTo.includes('household')
  );
}

/** Uses the firm-owned catalog adapter, but never writes firm definitions. */
export function CustomFieldsSection(props: SectionProps) {
  const enabled = useFlag('custom-fields-advisor');
  return enabled ? <EnabledCustomFieldsSection {...props} /> : null;
}

/**
 * This child only mounts after the feature gate has opened. Keeping the live
 * catalog reader here means a dark feature neither reads nor writes the firm
 * catalog when the record shell mounts every registered section.
 */
function EnabledCustomFieldsSection(props: SectionProps) {
  const { records, save } = useLiveCrmRecords();
  const [catalog, setCatalog] = useState<FieldCatalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const persistence = useMemo(
    () => createLiveFieldCatalogPersistence({ records, save }),
    [records, save]
  );

  useEffect(() => {
    let active = true;
    void persistence
      .load()
      .then((next) => {
        if (!active) return;
        setCatalog(next);
        setCatalogError(false);
      })
      .catch(() => {
        if (active) setCatalogError(true);
      });
    return () => {
      active = false;
    };
  }, [persistence]);

  if (catalogError) return <CustomFieldsLoadError />;
  if (!catalog) return null;
  return <CustomFieldsSectionContent {...props} catalog={catalog} />;
}

function CustomFieldsLoadError() {
  const { t } = useTranslation();
  return <p role="alert">{t('customFields.loadError')}</p>;
}

/** Exported for focused rendering tests; production mounts use the live catalog above. */
export function CustomFieldsSectionContent({
  household,
  onSaveHousehold,
  catalog,
}: SectionProps & { catalog: FieldCatalog }) {
  const enabled = useFlag('custom-fields-advisor');
  const { t } = useTranslation();
  const persistedValues = useMemo(
    () => readCustomFieldValues(household),
    [household]
  );
  const persistedSignature = JSON.stringify(persistedValues);
  const [values, setValues] = useState<CustomFieldValues>(persistedValues);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const dirtyKeysRef = useRef<Set<string>>(new Set());
  const seedContextRef = useRef<string | null>(null);

  useEffect(() => {
    const contextChanged = seedContextRef.current !== household.id;
    seedContextRef.current = household.id;
    if (contextChanged) {
      dirtyKeysRef.current = new Set();
      setSaveError(false);
    }
    setValues((current) => {
      if (contextChanged || dirtyKeysRef.current.size === 0)
        return persistedValues;
      const next = { ...persistedValues };
      for (const key of dirtyKeysRef.current) {
        const edited = current[key];
        if (edited !== undefined) next[key] = edited;
      }
      return next;
    });
  }, [household.id, persistedSignature, persistedValues]);

  if (!enabled) return null;
  const fields = visibleHouseholdFields(catalog);
  if (fields.length === 0) return null;

  const setValue = (id: string, value: CustomFieldValue) => {
    dirtyKeysRef.current.add(id);
    setValues((current) => ({ ...current, [id]: value }));
  };

  const submit = async () => {
    setSaving(true);
    setSaveError(false);
    try {
      if (!onSaveHousehold)
        throw new Error('Custom field persistence is unavailable.');
      await onSaveHousehold(withCustomFieldValues(household, values));
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      variant="raised"
      data-testid="custom-fields-advisor-section"
      style={{ display: 'grid', gap: 16, marginTop: 16 }}
    >
      <div>
        <h2 style={{ margin: 0 }}>{t('customFields.title')}</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--color-slate-500)' }}>
          {t('customFields.helper')}
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit().catch(() => {
            setSaveError(true);
          });
        }}
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        }}
      >
        {fields.map((field) => (
          <CustomFieldInput
            key={field.id}
            field={field}
            value={values[field.id]}
            onChange={(value) => {
              setValue(field.id, value);
            }}
          />
        ))}
        <div style={{ gridColumn: '1 / -1' }}>
          <Button
            type="submit"
            size="sm"
            loading={saving}
            data-testid="custom-fields-advisor-save"
          >
            {t('customFields.save')}
          </Button>
          {saveError ? <p role="alert">{t('customFields.saveError')}</p> : null}
        </div>
      </form>
    </Card>
  );
}

function CustomFieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldCatalogField;
  value: CustomFieldValue | undefined;
  onChange: (value: CustomFieldValue) => void;
}) {
  const id = `custom-field-value-${field.id}`;
  if (field.kind === 'boolean') {
    return (
      <label
        htmlFor={id}
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <input
          id={id}
          data-testid={id}
          type="checkbox"
          checked={value === true}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
        {field.name}
      </label>
    );
  }

  if (field.kind === 'select' || field.kind === 'multi-select') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <label htmlFor={id} style={{ display: 'grid', gap: 6 }}>
        <span>{field.name}</span>
        <select
          id={id}
          data-testid={id}
          multiple={field.kind === 'multi-select'}
          value={
            field.kind === 'multi-select'
              ? selected
              : typeof value === 'string'
                ? value
                : ''
          }
          onChange={(event) => {
            if (field.kind === 'multi-select') {
              onChange(
                Array.from(
                  event.currentTarget.selectedOptions,
                  (option) => option.value
                )
              );
              return;
            }
            onChange(event.target.value);
          }}
        >
          {field.kind === 'select' ? <option value="" /> : null}
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label htmlFor={id} style={{ display: 'grid', gap: 6 }}>
      <span>{field.name}</span>
      <input
        id={id}
        data-testid={id}
        type={inputType(field.kind)}
        step={field.kind === 'money' ? '0.01' : undefined}
        value={
          typeof value === 'number' || typeof value === 'string' ? value : ''
        }
        onChange={(event) => {
          if (field.kind === 'number' || field.kind === 'money') {
            const next = event.target.value;
            onChange(next === '' ? '' : Number(next));
            return;
          }
          onChange(event.target.value);
        }}
      />
    </label>
  );
}

function inputType(kind: CustomFieldKind): 'text' | 'number' | 'date' {
  if (kind === 'number' || kind === 'money') return 'number';
  return kind === 'date' ? 'date' : 'text';
}
