/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Card } from '@/ui/kp';
import type { CrmClientsActions, CrmFieldValue } from './adapters';

/** Contextual values/tags editor. It only reports a local-record edit to the CRM adapter. */
export function RecordMetadataEditor({
  values,
  tags = [],
  actions,
  onSaved,
}: {
  values: readonly CrmFieldValue[];
  tags?: readonly string[];
  actions?: CrmClientsActions;
  onSaved?: () => void;
}) {
  const [draftValues, setDraftValues] = useState<CrmFieldValue[]>([...values]);
  const [draftTags, setDraftTags] = useState<string[]>([...tags]);
  const [newTag, setNewTag] = useState('');
  return (
    <Card variant="raised" data-testid="crm-record-metadata-editor">
      <h3 style={{ marginTop: 0 }}>Fields and tags</h3>
      {draftValues.map((field, index) => (
        <label
          key={field.id}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(120px, 1fr) 2fr',
            gap: 8,
            marginBottom: 8,
          }}
        >
          <span>{field.label}</span>
          {field.type === 'select' ? (
            <select
              data-testid={`crm-field-value-${field.id}`}
              value={field.value}
              onChange={(event) =>
                { setDraftValues((current) =>
                  current.map((value, i) =>
                    i === index
                      ? { ...value, value: event.target.value }
                      : value
                  )
                ); }
              }
            >
              {field.options?.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          ) : (
            <input
              data-testid={`crm-field-value-${field.id}`}
              type={
                field.type === 'number'
                  ? 'number'
                  : field.type === 'date'
                    ? 'date'
                    : 'text'
              }
              value={field.value}
              onChange={(event) =>
                { setDraftValues((current) =>
                  current.map((value, i) =>
                    i === index
                      ? { ...value, value: event.target.value }
                      : value
                  )
                ); }
              }
            />
          )}
        </label>
      ))}
      <div>
        <strong>Tags</strong>
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}
        >
          {draftTags.map((tag) => (
            <span
              key={tag}
              style={{
                background: 'var(--color-sky-100)',
                padding: '3px 7px',
                borderRadius: 999,
              }}
            >
              {tag}{' '}
              <button
                type="button"
                data-testid={`crm-tag-remove-${tag}`}
                aria-label={`Remove ${tag}`}
                onClick={() =>
                  { setDraftTags((current) =>
                    current.filter((value) => value !== tag)
                  ); }
                }
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            data-testid="crm-tag-input"
            value={newTag}
            placeholder="Add a tag"
            onChange={(event) => { setNewTag(event.target.value); }}
          />
          <Button
            size="sm"
            variant="secondary"
            iconLeft={Plus}
            onClick={() => {
              const tag = newTag.trim();
              if (tag && !draftTags.includes(tag))
                setDraftTags((current) => [...current, tag]);
              setNewTag('');
            }}
          >
            Add tag
          </Button>
        </div>
      </div>
      <Button
        size="sm"
        style={{ marginTop: 14 }}
        data-testid="crm-save-metadata"
        onClick={() => {
          const saved = actions?.onSaveMetadata?.(draftValues, draftTags);
          if (saved && typeof (saved as Promise<void>).then === 'function') {
            void (saved as Promise<void>).then(onSaved);
          } else {
            onSaved?.();
          }
        }}
      >
        Save fields and tags
      </Button>
    </Card>
  );
}
