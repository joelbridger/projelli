import { useEffect, useState } from 'react';

import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { copyRequestBlueprint, BlueprintValidationError } from '@/platform/intake/blueprintValidation';
import { useBlueprintStore } from '@/platform/intake/blueprintStore';
import type { RequestBlueprint } from '@/platform/intake/blueprintTypes';
import type { FactKind, RequestItem, TypedFieldInputFormat } from '@/platform/intake/types';
import {
  draftDocUpload,
  draftGuidedQuestion,
  draftTypedField,
  draftWelcomeCard,
  insertItem,
  moveItem,
  removeItem,
} from '@/platform/intake/formBuilder/formItemDrafts';

/* eslint-disable lantern-i18n/no-hardcoded-string -- Form builder copy ships with the Lane 1 UI. */

export interface FormBuilderEditorProps {
  blueprint: RequestBlueprint | null;
  onSaved: (blueprint: RequestBlueprint) => void;
  onCancel: () => void;
}

const FACT_KINDS: FactKind[] = [
  'dob', 'ssn', 'income_annual', 'spending_monthly', 'drivers_license',
  'address', 'citizenship', 'employer', 'beneficiary',
];

type TypedFieldFactKind = Exclude<FactKind, 'drivers_license'>;

const TYPED_FIELD_FACT_KINDS: TypedFieldFactKind[] = [
  'dob', 'ssn', 'income_annual', 'spending_monthly', 'address', 'citizenship', 'employer', 'beneficiary',
];

const INPUTS_BY_FACT_KIND: Record<TypedFieldFactKind, TypedFieldInputFormat[]> = {
  dob: ['date'],
  ssn: ['ssn'],
  income_annual: ['money', 'number'],
  spending_monthly: ['money', 'number'],
  address: ['text', 'textarea'],
  citizenship: ['text', 'select'],
  employer: ['text', 'textarea'],
  beneficiary: ['text', 'textarea'],
};

function firstInputFor(kind: TypedFieldFactKind): TypedFieldInputFormat {
  switch (kind) {
    case 'dob': return 'date';
    case 'ssn': return 'ssn';
    case 'income_annual': return 'money';
    case 'spending_monthly': return 'money';
    case 'address': return 'text';
    case 'citizenship': return 'text';
    case 'employer': return 'text';
    case 'beneficiary': return 'text';
  }
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function positiveIntOrFallback(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fallback;
}

function friendlyType(item: RequestItem): string {
  return item.t === 'typed_field' ? 'Typed field'
    : item.t === 'doc_upload' ? 'Document upload'
      : item.t === 'guided_question' ? 'Guided question'
        : item.t === 'pdf_fill' ? 'PDF form'
          : item.t === 'signature' ? 'Signature request' : 'Text block';
}

function slugFor(label: string): string {
  return label.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
}

function bytesToMb(value: number | undefined): string {
  return String((value ?? 100 * 1024 * 1024) / (1024 * 1024));
}

function ItemEditor({ item, index, count, onChange, onMove, onRemove }: {
  item: RequestItem;
  index: number;
  count: number;
  onChange: (next: RequestItem) => void;
  onMove: (direction: 'up' | 'down') => void;
  onRemove: () => void;
}): React.JSX.Element {
  if (item.t === 'readonly_card') {
    return (
      <article className="grid gap-2 rounded-lg border border-[var(--kp-divider)] bg-background p-4" aria-label="Preserved legacy text block">
        <strong>{item.label || 'Legacy text block'}</strong>
        <p className="m-0 text-sm text-muted-foreground">This older text block will be kept when you save, but can’t be edited here.</p>
      </article>
    );
  }

  if (item.t === 'pdf_fill') {
    return (
      <article className="grid gap-2 rounded-lg border border-[var(--kp-divider)] bg-background p-4" aria-label="Approved PDF form">
        <strong>{item.label || 'Approved PDF form'}</strong>
        <p className="m-0 text-sm text-muted-foreground">This approved PDF form will be kept when you save, but can’t be edited in this builder.</p>
      </article>
    );
  }

  if (item.t === 'signature') {
    return (
      <article className="grid gap-2 rounded-lg border border-[var(--kp-divider)] bg-background p-4" aria-label="Signature request">
        <strong>{item.label || 'Signature request'}</strong>
        <p className="m-0 text-sm text-muted-foreground">This signature request will be kept when you save, but can’t be edited in this builder.</p>
      </article>
    );
  }

  const common = (patch: Partial<RequestItem>) => {
    onChange({ ...item, ...patch } as RequestItem);
  };
  return (
    <article className="grid gap-3 rounded-lg border border-[var(--kp-divider)] bg-background p-4" aria-label={`Edit ${friendlyType(item)}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{item.label || `Untitled ${friendlyType(item)}`}</strong>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="outline" disabled={index === 0} onClick={() => { onMove('up'); }}>Move up</Button>
          <Button type="button" size="sm" variant="outline" disabled={index === count - 1} onClick={() => { onMove('down'); }}>Move down</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onRemove}>Remove</Button>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${item.item_id}-label`}>Label</Label>
        <Input id={`${item.item_id}-label`} value={item.label} onChange={(event) => { common({ label: event.target.value }); }} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${item.item_id}-help`}>Help text</Label>
        <Input id={`${item.item_id}-help`} value={item.help_text} onChange={(event) => { common({ help_text: event.target.value }); }} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={item.required} onChange={(event) => { common({ required: event.target.checked }); }} /> Required
      </label>
      <div className="grid gap-2">
        <Label htmlFor={`${item.item_id}-subject`}>Who this is for</Label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={item.subject === 'primary' ? 'default' : 'outline'} onClick={() => { common({ subject: 'primary' }); }}>Primary person</Button>
          <Button type="button" size="sm" variant={item.subject === 'household' ? 'default' : 'outline'} onClick={() => { common({ subject: 'household' }); }}>Household</Button>
        </div>
        <Input id={`${item.item_id}-subject`} value={item.subject} onChange={(event) => { common({ subject: event.target.value }); }} />
      </div>

      {item.t === 'typed_field' ? (
        <>
          <div className="grid gap-2">
            <Label htmlFor={`${item.item_id}-fact-kind`}>Information to collect</Label>
            <select id={`${item.item_id}-fact-kind`} value={item.fact_kind} onChange={(event) => {
              const factKind = event.target.value as TypedFieldFactKind;
              onChange({ ...item, fact_kind: factKind, input: firstInputFor(factKind) });
            }}>
              {TYPED_FIELD_FACT_KINDS.map((kind) => <option key={kind} value={kind}>{kind.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${item.item_id}-input`}>Answer format</Label>
            <select id={`${item.item_id}-input`} value={item.input} onChange={(event) => { onChange({ ...item, input: event.target.value as TypedFieldInputFormat }); }}>
              {INPUTS_BY_FACT_KIND[item.fact_kind as TypedFieldFactKind].map((input) => <option key={input} value={input}>{input}</option>)}
            </select>
          </div>
        </>
      ) : null}

      {item.t === 'doc_upload' ? (
        <>
          <fieldset className="grid gap-2"><legend className="text-sm font-medium">Accepted files</legend>
            {['image/jpeg', 'image/png', 'application/pdf'].map((mime) => {
              const selected = item.accepted_mime_types?.includes(mime) ?? false;
              return <label key={mime} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected} onChange={(event) => {
                const current = item.accepted_mime_types ?? [];
                onChange({ ...item, accepted_mime_types: event.target.checked ? [...current, mime] : current.filter((value) => value !== mime) });
              }} />{mime}</label>;
            })}
          </fieldset>
          <div className="grid gap-2"><Label htmlFor={`${item.item_id}-max-files`}>Maximum files</Label><Input id={`${item.item_id}-max-files`} type="number" min="1" value={positiveIntOrFallback(item.max_files, 1)} onChange={(event) => { onChange({ ...item, max_files: parsePositiveInt(event.target.value, positiveIntOrFallback(item.max_files, 1)) }); }} /></div>
          <div className="grid gap-2"><Label htmlFor={`${item.item_id}-max-mb`}>Maximum size in MB</Label><Input id={`${item.item_id}-max-mb`} type="number" min="1" value={bytesToMb(positiveIntOrFallback(item.max_bytes, 100 * 1024 * 1024))} onChange={(event) => { onChange({ ...item, max_bytes: parsePositiveInt(event.target.value, positiveIntOrFallback(item.max_bytes, 100 * 1024 * 1024) / (1024 * 1024)) * 1024 * 1024 }); }} /></div>
        </>
      ) : null}

      {item.t === 'guided_question' ? (
        <>
          <div className="grid gap-2"><Label htmlFor={`${item.item_id}-prompt`}>Question</Label><Input id={`${item.item_id}-prompt`} value={item.prompt} onChange={(event) => { onChange({ ...item, prompt: event.target.value }); }} /></div>
          <fieldset className="grid gap-2"><legend className="text-sm font-medium">Answer format</legend>
            {(['money', 'range'] as const).map((format) => <label key={format} className="flex items-center gap-2 text-sm"><input type="radio" name={`${item.item_id}-format`} value={format} checked={item.response_format === format} onChange={() => { onChange({ ...item, response_format: format }); }} />{format}</label>)}
          </fieldset>
          <div className="grid gap-2"><Label htmlFor={`${item.item_id}-question-fact`}>Save as information</Label><select id={`${item.item_id}-question-fact`} value={item.fact_kind ?? ''} onChange={(event) => {
            const value = event.target.value as FactKind | '';
            const { fact_kind: previousFactKind, ...withoutFactKind } = item;
            const nextItem = value
              ? { ...withoutFactKind, fact_kind: value }
              : previousFactKind === undefined ? item : withoutFactKind;
            onChange(nextItem);
          }}><option value="">None</option>{FACT_KINDS.map((kind) => <option key={kind} value={kind}>{kind.replace(/_/g, ' ')}</option>)}</select></div>
        </>
      ) : null}

    </article>
  );
}

export function FormBuilderEditor(props: FormBuilderEditorProps): React.JSX.Element {
  const createFirmBlueprint = useBlueprintStore((state) => state.createFirmBlueprint);
  const updateFirmBlueprint = useBlueprintStore((state) => state.updateFirmBlueprint);
  const [label, setLabel] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [items, setItems] = useState<RequestItem[]>([]);
  const [error, setError] = useState('');
  const readOnly = props.blueprint?.source === 'built_in';

  /* eslint-disable react-hooks/set-state-in-effect -- A newly selected blueprint must replace this local editing draft. */
  useEffect(() => {
    const copy = props.blueprint ? copyRequestBlueprint(props.blueprint) : null;
    const firstItem = copy?.items[0];
    const hasWelcomeFirst = firstItem?.t === 'readonly_card' && firstItem.item_id.toLowerCase().includes('welcome');
    setLabel(copy?.label ?? '');
    setWelcomeMessage(hasWelcomeFirst ? firstItem.body : '');
    setItems(hasWelcomeFirst ? copy?.items.slice(1) ?? [] : copy?.items ?? []);
    setError('');
  }, [props.blueprint]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const updateItem = (next: RequestItem) => {
    setItems((current) => current.map((item) => item.item_id === next.item_id ? next : item));
  };
  const add = (item: RequestItem) => {
    setItems((current) => insertItem(current, current.length, item));
  };
  const save = () => {
    setError('');
    try {
      const savedItems = [
        ...(welcomeMessage.trim() ? [draftWelcomeCard(welcomeMessage)] : []),
        ...items,
      ];
      const result = props.blueprint
        ? updateFirmBlueprint(props.blueprint.blueprintId, { label, items: savedItems })
        : createFirmBlueprint({ blueprintId: slugFor(label), label, items: savedItems });
      props.onSaved(result);
    } catch (cause) {
      setError(cause instanceof BlueprintValidationError ? cause.message : 'This form could not be saved. Please try again.');
    }
  };

  if (readOnly && props.blueprint) {
    return <section className="grid gap-4" aria-label="Form builder"><h2 className="m-0 text-xl font-semibold">{props.blueprint.label}</h2><p className="m-0 text-sm text-muted-foreground">This built-in form is ready to use and cannot be changed.</p><ol className="grid gap-2 pl-5">{props.blueprint.items.map((item) => <li key={item.item_id}><span className="font-medium">{item.label}</span> <span className="text-muted-foreground">{friendlyType(item)}</span></li>)}</ol><Button type="button" variant="outline" onClick={props.onCancel}>Close</Button></section>;
  }

  return (
    <section className="grid gap-5" aria-label="Form builder">
      <div className="grid gap-2"><Label htmlFor="form-name">Form name</Label><Input id="form-name" value={label} onChange={(event) => { setLabel(event.target.value); }} placeholder="For example, Annual review" /></div>
      <div className="grid gap-2"><Label htmlFor="welcome-message">Welcome message</Label><Textarea id="welcome-message" value={welcomeMessage} onChange={(event) => { setWelcomeMessage(event.target.value); }} placeholder="Optional message shown before the client starts" /></div>
      <section className="grid gap-2 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] p-3" aria-label="Form preview"><h2 className="m-0 text-base font-semibold">Form preview</h2>{items.length === 0 ? <p className="m-0 text-sm text-muted-foreground">Add items to see the form take shape.</p> : <ol className="m-0 grid gap-1 pl-5">{items.map((item) => <li key={item.item_id}>{item.label || 'Untitled item'} <span className="text-muted-foreground">{friendlyType(item)}</span></li>)}</ol>}</section>
      <div className="flex flex-wrap gap-2" aria-label="Add item"><Button type="button" variant="outline" onClick={() => { add(draftTypedField()); }}>Add typed field</Button><Button type="button" variant="outline" onClick={() => { add(draftDocUpload()); }}>Add document upload</Button><Button type="button" variant="outline" onClick={() => { add(draftGuidedQuestion()); }}>Add guided question</Button></div>
      <div className="grid gap-4">{items.map((item, index) => <ItemEditor key={item.item_id} item={item} index={index} count={items.length} onChange={updateItem} onMove={(direction) => { setItems((current) => moveItem(current, index, direction)); }} onRemove={() => { setItems((current) => removeItem(current, item.item_id)); }} />)}</div>
      {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2"><Button type="button" variant="outline" onClick={props.onCancel}>Cancel</Button><Button type="button" onClick={save}>Save form</Button></div>
    </section>
  );
}

/* eslint-enable lantern-i18n/no-hardcoded-string */
