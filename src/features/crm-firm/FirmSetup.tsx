/* eslint-disable lantern-i18n/no-hardcoded-string -- CRM copy is catalogued with the frozen CRM screens. */
import { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowRightLeft, Plus, Save, Users } from 'lucide-react';
import { Button } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type {
  CustomFieldDef,
  CustomFieldValueMap,
  EntityKind,
  Provenance,
  Tag,
} from '@/platform/crm/types';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

type Tab = 'setup' | 'fields' | 'tags' | 'values';
type FieldType = CustomFieldDef['fieldType'];
type CustomFieldValue = CustomFieldValueMap[string];
type RecordWithMetadata = LiveCrmRecord & { customFields?: Record<string, CustomFieldValue>; tagIds?: string[]; tags?: string[] };
type LiveCustomFieldDef = LiveCrmRecord & CustomFieldDef;
type LiveTag = LiveCrmRecord & Tag;

const panelStyle = { border: '1px solid var(--kp-border)', borderRadius: 'var(--radius-lg)', background: 'var(--kp-surface)', padding: 'var(--kp-space-md)' } as const;
const mutedStyle = { color: 'var(--kp-text-faint)', fontSize: 'var(--kp-font-sm)' } as const;
const fieldTypes: readonly FieldType[] = ['text', 'number', 'money', 'date', 'bool', 'enum', 'multi-enum'];
const recordKinds: readonly EntityKind[] = ['household', 'person', 'account', 'task', 'opportunity'];

function actor() {
  return { userId: 'local-user', display: 'You', kind: 'user' as const };
}

function source(): Provenance {
  return { origin: 'user', sources: [] };
}

function designToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function firmRecordBase(kind: 'tag' | 'customFieldDef', id: string) {
  const now = new Date().toISOString();
  return { id, kind, matterId: 'firm_home', createdAt: now, createdBy: actor(), updatedAt: now, updatedBy: actor(), source: source(), deleted: false, externalRefs: [], schemaVersion: 1 };
}

function recordLabel(record: LiveCrmRecord): string {
  const name = record['name'];
  const title = record['title'];
  return typeof name === 'string' && name.trim() ? name : typeof title === 'string' && title.trim() ? title : `Untitled ${record.kind}`;
}

function savedItemType(kind: string): string {
  return ({ household: 'Household', person: 'Person', account: 'Account', task: 'Task', opportunity: 'Opportunity' } as Record<string, string>)[kind] ?? 'Saved item';
}

function customValues(record: RecordWithMetadata): Record<string, CustomFieldValue> {
  return record.customFields && !Array.isArray(record.customFields) ? record.customFields : {};
}

function inputValue(value: CustomFieldValue['value'] | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value == null ? '' : String(value);
}

function parseValue(raw: string, field: CustomFieldDef): CustomFieldValue['value'] {
  if (field.fieldType === 'number' || field.fieldType === 'money') {
    const number = Number(raw);
    return raw.trim() && Number.isFinite(number) ? number : null;
  }
  if (field.fieldType === 'bool') return raw === 'true';
  if (field.fieldType === 'multi-enum') return raw.split(',').map((item) => item.trim()).filter(Boolean);
  return raw.trim() || null;
}

function hasFieldValue(records: readonly LiveCrmRecord[], key: string): boolean {
  return records.some((item) => {
    const values = customValues(item as RecordWithMetadata);
    const value = values[key]?.value;
    return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
  });
}

function MemberDirectory({ records }: { records: readonly LiveCrmRecord[] }) {
  const entries = records.filter((record) => record.kind === 'firmDirectoryEntry');
  return <section data-testid="crm-firm-directory" style={panelStyle}>
    <h3 style={{ marginTop: 0 }}>Members, roles, and teams</h3>
    {entries.length === 0 ? <p data-testid="crm-firm-directory-empty" style={mutedStyle}>No firm members are available here yet. Add members, roles, teams, invitations, or access in firm administration. This page only shows the result.</p> : <div>{entries.map((entry) => <div key={entry.id} data-testid={`crm-firm-directory-${entry.id}`} style={{ borderTop: '1px solid var(--kp-border)', padding: '10px 0' }}><strong>{typeof entry['displayName'] === 'string' ? entry['displayName'] : 'Unnamed member'}</strong><span data-testid={`crm-firm-role-${entry.id}`} style={mutedStyle}> · {typeof entry['title'] === 'string' ? entry['title'] : 'No role supplied'} · {entry['active'] === false ? 'Inactive' : 'Active'}</span><p data-testid={`crm-firm-team-${entry.id}`} style={{ ...mutedStyle, marginBottom: 0 }}>{Array.isArray(entry['teamLabels']) && entry['teamLabels'].length ? `Teams: ${(entry['teamLabels'] as string[]).join(', ')}` : 'No teams supplied'}</p></div>)}</div>}
    <p style={{ ...mutedStyle, marginBottom: 0 }}>This is a read-only view. Firm administration remains the only place that can change roles, teams, invitations, deactivation, or access.</p>
  </section>;
}

function EthicalWallNotice() {
  return <section data-testid="crm-ethical-wall-notice" style={{ ...panelStyle, borderColor: 'var(--kp-assured)' }}>
    <h3 style={{ marginTop: 0 }}>Restricted client access</h3>
    <p>Restricted clients are protected by withholding the client’s encryption key. A person without that key cannot open the client record, even if a copy of encrypted data reaches their device.</p>
    <p style={{ ...mutedStyle, marginBottom: 0 }}>This page cannot grant or remove access. Set restrictions in firm administration, where key membership is managed.</p>
  </section>;
}

function FirmAccessReadModel({ onSave }: { onSave: (record: LiveCrmRecord) => Promise<unknown> }) {
  const [schedulingLink, setSchedulingLink] = useState('https://calendly.com/your-firm/intro');
  const [saved, setSaved] = useState(false);
  const saveSchedulingLink = async () => {
    await onSave({ id: 'service-policy:standard', kind: 'servicePolicy', matterId: 'firm_home', name: 'Standard service', schedulingLinkUrl: schedulingLink.trim(), updatedAt: new Date().toISOString() });
    setSaved(true);
  };
  return <section data-testid="crm-firm-access-read-model" style={panelStyle}>
    <h3 style={{ marginTop: 0 }}>Members and access</h3>
    <p style={mutedStyle}>This page shows your firm’s current members, roles, and teams. Firm administration is the only place to invite people, change a role, manage teams, or change access.</p>
    <div data-testid="crm-firm-visibility-read-model" style={{ marginBottom: 10 }}>
      <strong>Private client access</strong>
      <p style={{ ...mutedStyle, margin: '4px 0 0' }}>Restricted client access is managed through the firm’s existing encryption-key membership. This CRM page cannot create a group or grant access.</p>
    </div>
    <div data-testid="crm-firm-permissions-read-model" style={{ marginBottom: 12 }}>
      <strong>Default access</strong>
      <p style={{ ...mutedStyle, margin: '4px 0 0' }}>Roles and permissions are managed in firm administration, so there is one source of truth for your firm.</p>
    </div>
    <label>Scheduling link<input data-testid="crm-service-policy-scheduling-link" value={schedulingLink} onChange={(event) => { setSchedulingLink(event.target.value); }} /></label>
    <Button data-testid="crm-service-policy-save" style={{ marginTop: 6 }} onClick={() => { void saveSchedulingLink(); }}>Save scheduling link</Button>
    {saved && <p role="status">Saved the scheduling link.</p>}
  </section>;
}

function FieldEditor({ current, records, onSave, onClose }: { current?: CustomFieldDef; records: readonly LiveCrmRecord[]; onSave: (record: CustomFieldDef) => Promise<void>; onClose: () => void }) {
  const [label, setLabel] = useState(current?.label ?? '');
  const [key, setKey] = useState(current?.key ?? '');
  const [fieldType, setFieldType] = useState<FieldType>(current?.fieldType ?? 'text');
  const [appliesTo, setAppliesTo] = useState<readonly EntityKind[]>(current?.appliesTo ?? ['household']);
  const [options, setOptions] = useState((current?.options ?? []).join(', '));
  const [required, setRequired] = useState(current?.required ?? false);
  const [error, setError] = useState<string | null>(null);
  const hasValues = current ? hasFieldValue(records, current.key) : false;
  const save = async () => {
    const trimmedLabel = label.trim();
    const trimmedKey = key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
    if (!trimmedLabel || !trimmedKey || appliesTo.length === 0) { setError('Give the field a name, a short key, and at least one record type.'); return; }
    if ((fieldType === 'enum' || fieldType === 'multi-enum') && !options.split(',').some((item) => item.trim())) { setError('Add at least one choice for this field.'); return; }
    setError(null);
    const id = current?.id ?? `custom-field:${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await onSave({ ...(current ?? firmRecordBase('customFieldDef', id)), id, kind: 'customFieldDef', matterId: 'firm_home', key: current?.key ?? trimmedKey, label: trimmedLabel, fieldType, appliesTo: [...appliesTo], ...(fieldType === 'enum' || fieldType === 'multi-enum' ? { options: options.split(',').map((item) => item.trim()).filter(Boolean) } : {}), required, order: current?.order ?? Date.now(), archived: current?.archived ?? false, updatedAt: now, updatedBy: actor() });
    onClose();
  };
  return <section data-testid="crm-field-editor" style={panelStyle}><h3 style={{ marginTop: 0 }}>{current ? 'Edit custom field' : 'New custom field'}</h3><label style={{ display: 'block', marginBottom: 8 }}>Label<input data-testid="crm-field-label" value={label} onChange={(event) => { setLabel(event.target.value); }} /></label><label style={{ display: 'block', marginBottom: 8 }}>Short key<input data-testid="crm-field-key" disabled={Boolean(current)} value={key} onChange={(event) => { setKey(event.target.value); }} /></label><label style={{ display: 'block', marginBottom: 8 }}>Type<select data-testid="crm-field-type" disabled={hasValues} value={fieldType} onChange={(event) => { setFieldType(event.target.value as FieldType); }}>{fieldTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>{hasValues && <p role="status" style={mutedStyle}>This field already has values, so its type cannot change. Create a replacement field instead.</p>}<fieldset style={{ border: 0, padding: 0, margin: '0 0 8px' }}><legend>Show on</legend>{recordKinds.map((kind) => <label key={kind} style={{ marginRight: 12 }}><input type="checkbox" data-testid={`crm-field-applies-${kind}`} checked={appliesTo.includes(kind)} onChange={(event) => { setAppliesTo((currentKinds) => event.target.checked ? [...currentKinds, kind] : currentKinds.filter((item) => item !== kind)); }} /> {kind}</label>)}</fieldset>{(fieldType === 'enum' || fieldType === 'multi-enum') && <label style={{ display: 'block', marginBottom: 8 }}>Choices, separated by commas<input data-testid="crm-field-options" value={options} onChange={(event) => { setOptions(event.target.value); }} /></label>}<label><input data-testid="crm-field-required" type="checkbox" checked={required} onChange={(event) => { setRequired(event.target.checked); }} /> Required</label>{error && <p role="alert">{error}</p>}<div style={{ display: 'flex', gap: 8, marginTop: 12 }}><Button data-testid="crm-field-save" iconLeft={Save} onClick={() => { void save(); }}>Save field</Button><Button variant="secondary" onClick={onClose}>Cancel</Button></div></section>;
}

function FieldsAdmin({ records, onSave }: { records: readonly LiveCrmRecord[]; onSave: (record: LiveCrmRecord) => Promise<unknown> }) {
  const fields = useMemo(() => records.filter((record): record is LiveCustomFieldDef => record.kind === 'customFieldDef' && !record['deleted']).sort((a, b) => a.order - b.order), [records]);
  const [editing, setEditing] = useState<CustomFieldDef | undefined>();
  const [creating, setCreating] = useState(false);
  const archive = async (field: CustomFieldDef) => { await onSave({ ...field, archived: true, updatedAt: new Date().toISOString(), updatedBy: actor() }); };
  return <section data-testid="crm-fields-admin" style={panelStyle}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}><div><h3 style={{ margin: 0 }}>Custom fields</h3><p style={mutedStyle}>Use these for facts your firm wants to collect the same way every time.</p></div><Button data-testid="crm-field-create" iconLeft={Plus} onClick={() => { setCreating(true); setEditing(undefined); }}><span data-testid="crm-field-new">New field</span></Button></div>{creating && <FieldEditor records={records} onSave={async (record) => { await onSave(record as LiveCustomFieldDef); }} onClose={() => { setCreating(false); }} />}{editing && <FieldEditor current={editing} records={records} onSave={async (record) => { await onSave(record as LiveCustomFieldDef); }} onClose={() => { setEditing(undefined); }} />}{fields.length === 0 && !creating ? <p data-testid="crm-fields-empty" style={mutedStyle}>No custom fields yet. Create one when a standard field does not cover what your firm needs.</p> : <div>{fields.map((field) => <div key={field.id} data-testid={`crm-field-row-${field.id}`} style={{ borderTop: '1px solid var(--kp-border)', padding: '10px 0' }}><strong>{field.label}</strong><span style={mutedStyle}> · {field.fieldType} · {field.appliesTo.join(', ')} · {field.required ? 'Required' : 'Optional'}{field.archived ? ' · Archived' : ''}</span><div style={{ display: 'flex', gap: 8, marginTop: 7 }}>{!field.archived && <><Button size="sm" variant="secondary" data-testid={`crm-field-edit-${field.id}`} onClick={() => { setEditing(field); setCreating(false); }}>Edit</Button><Button size="sm" variant="secondary" data-testid={`crm-field-archive-${field.id}`} iconLeft={Archive} onClick={() => { void archive(field); }}>Archive</Button></>}</div></div>)}</div>}</section>;
}

function TagEditor({ current, onSave, onClose }: { current?: Tag; onSave: (tag: Tag) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(current?.name ?? '');
  const [color, setColor] = useState(current?.color ?? designToken('--kp-blue'));
  const [category, setCategory] = useState(current?.category ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = async () => { if (!name.trim()) { setError('Give this tag a name.'); return; } const id = current?.id ?? `tag:${crypto.randomUUID()}`; await onSave({ ...(current ?? firmRecordBase('tag', id)), id, kind: 'tag', matterId: 'firm_home', name: name.trim(), color, ...(category.trim() ? { category: category.trim() } : {}), updatedAt: new Date().toISOString(), updatedBy: actor() }); onClose(); };
  return <section data-testid="crm-tag-editor" style={panelStyle}><h3 style={{ marginTop: 0 }}>{current ? 'Edit tag' : 'New tag'}</h3><label style={{ display: 'block', marginBottom: 8 }}>Name<input data-testid="crm-tag-name" value={name} onChange={(event) => { setName(event.target.value); }} /></label><label style={{ display: 'block', marginBottom: 8 }}>Color<input data-testid="crm-tag-color" type="color" value={color} onChange={(event) => { setColor(event.target.value); }} /></label><label style={{ display: 'block', marginBottom: 8 }}>Group (optional)<input data-testid="crm-tag-category" value={category} onChange={(event) => { setCategory(event.target.value); }} /></label>{error && <p role="alert">{error}</p>}<div style={{ display: 'flex', gap: 8 }}><Button data-testid="crm-tag-save" onClick={() => { void save(); }}>Save tag</Button><Button variant="secondary" onClick={onClose}>Cancel</Button></div></section>;
}

function TagsAdmin({ records, onSave }: { records: readonly LiveCrmRecord[]; onSave: (record: LiveCrmRecord) => Promise<unknown> }) {
  const tags = useMemo(() => records.filter((record): record is LiveTag => record.kind === 'tag').sort((a, b) => a.name.localeCompare(b.name)), [records]);
  const [editing, setEditing] = useState<Tag | undefined>();
  const [creating, setCreating] = useState(false);
  const [mergeSource, setMergeSource] = useState<Tag | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const mergeAffectedCount = mergeSource ? records.filter((record) => record.kind !== 'tag' && ((Array.isArray(record['tagIds']) && (record['tagIds'] as unknown[]).includes(mergeSource.id)) || (Array.isArray(record['tags']) && (record['tags'] as unknown[]).includes(mergeSource.name)))).length : 0;
  const archive = async (tag: Tag) => { await onSave({ ...tag, deleted: true, updatedAt: new Date().toISOString(), updatedBy: actor() }); };
  const merge = async () => {
    if (!mergeSource || !mergeTargetId || mergeTargetId === mergeSource.id) return;
    const target = tags.find((tag) => tag.id === mergeTargetId);
    if (!target) return;
    const affected = records.filter((record) => record.kind !== 'tag' && ((Array.isArray(record['tagIds']) && (record['tagIds'] as unknown[]).includes(mergeSource.id)) || (Array.isArray(record['tags']) && (record['tags'] as unknown[]).includes(mergeSource.name))));
    await Promise.all(affected.map((record) => {
      const ids = Array.isArray(record['tagIds']) ? record['tagIds'].filter((id): id is string => typeof id === 'string' && id !== mergeSource.id) : [];
      const names = Array.isArray(record['tags']) ? record['tags'].filter((name): name is string => typeof name === 'string' && name !== mergeSource.name) : [];
      return onSave({ ...record, tagIds: [...new Set([...ids, target.id])], tags: [...new Set([...names, target.name])], updatedAt: new Date().toISOString(), updatedBy: actor() });
    }));
    await onSave({ ...mergeSource, deleted: true, updatedAt: new Date().toISOString(), updatedBy: actor() });
    setMergeSource(null); setMergeTargetId('');
  };
  return <section data-testid="crm-tags-admin" style={panelStyle}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}><div><h3 style={{ margin: 0 }}>Tags</h3><p style={mutedStyle}>Short labels for finding related records quickly.</p></div><Button data-testid="crm-tag-create" iconLeft={Plus} onClick={() => { setCreating(true); setEditing(undefined); }}>New tag</Button></div>{creating && <TagEditor onSave={async (tag) => { await onSave(tag as LiveTag); }} onClose={() => { setCreating(false); }} />}{editing && <TagEditor current={editing} onSave={async (tag) => { await onSave(tag as LiveTag); }} onClose={() => { setEditing(undefined); }} />}{mergeSource && <section data-testid="crm-tag-merge" style={panelStyle}><strong>Merge {mergeSource.name} into</strong><select data-testid="crm-tag-merge-target" value={mergeTargetId} onChange={(event) => { setMergeTargetId(event.target.value); }}><option value="">Choose a tag</option>{tags.filter((tag) => tag.id !== mergeSource.id && !tag.deleted).map((tag) => <option value={tag.id} key={tag.id}>{tag.name}</option>)}</select><p data-testid="crm-tag-merge-preview" style={mutedStyle}>{String(mergeAffectedCount)} saved record{mergeAffectedCount === 1 ? '' : 's'} will move to the tag you choose. The old tag will then be archived.</p><Button data-testid="crm-tag-merge-save" disabled={!mergeTargetId} iconLeft={ArrowRightLeft} onClick={() => { void merge(); }}>Merge tags</Button> <Button variant="secondary" onClick={() => { setMergeSource(null); }}>Cancel</Button></section>}{tags.length === 0 && !creating ? <p data-testid="crm-tags-empty" style={mutedStyle}>No tags yet. Add one when it will help people find records later.</p> : <div>{tags.map((tag) => <div key={tag.id} data-testid={`crm-tag-row-${tag.id}`} style={{ borderTop: '1px solid var(--kp-border)', padding: '10px 0' }}><span aria-hidden style={{ display: 'inline-block', height: 10, width: 10, borderRadius: 99, background: tag.color ?? 'var(--kp-text-faint)', marginRight: 6 }} /><strong>{tag.name}</strong><span style={mutedStyle}>{tag.category ? ` · ${tag.category}` : ''}{tag.deleted ? ' · Archived' : ''}</span>{!tag.deleted && <div style={{ display: 'flex', gap: 8, marginTop: 7 }}><Button size="sm" variant="secondary" data-testid={`crm-tag-edit-${tag.id}`} onClick={() => { setEditing(tag); setCreating(false); }}>Edit</Button><Button size="sm" variant="secondary" data-testid={`crm-tag-merge-${tag.id}`} onClick={() => { setMergeSource(tag); }}>Merge</Button><Button size="sm" variant="secondary" data-testid={`crm-tag-archive-${tag.id}`} iconLeft={Archive} onClick={() => { void archive(tag); }}>Archive</Button></div>}</div>)}</div>}</section>;
}

function RecordValues({ records, onSave }: { records: readonly LiveCrmRecord[]; onSave: (record: LiveCrmRecord) => Promise<unknown> }) {
  const fieldDefs = useMemo(() => records.filter((record): record is LiveCustomFieldDef => record.kind === 'customFieldDef' && !record['deleted'] && !record['archived']), [records]);
  const editableRecords = useMemo(() => records.filter((record) => recordKinds.includes(record.kind as EntityKind)), [records]);
  const [recordId, setRecordId] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [tagIds, setTagIds] = useState<string[]>([]);
  const tags = useMemo(() => records.filter((record): record is LiveTag => record.kind === 'tag' && !record['deleted']), [records]);
  const selected = editableRecords.find((record) => record.id === recordId) as RecordWithMetadata | undefined;
  const applicable = selected ? fieldDefs.filter((field) => field.appliesTo.includes(selected.kind as EntityKind)) : [];
  // This resets the edit form when the advisor chooses a different saved record.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!selected) { setDraft({}); setTagIds([]); return; } const values = customValues(selected); setDraft(Object.fromEntries(applicable.map((field) => [field.key, inputValue(values[field.key]?.value)]))); setTagIds(Array.isArray(selected.tagIds) ? selected.tagIds : []); }, [recordId, selected?.updatedAt, applicable.map((field) => field.id).join('|')]);
  const save = async () => { if (!selected) return; const existing = customValues(selected); const updatedAt = new Date().toISOString(); const nextValues = { ...existing, ...Object.fromEntries(applicable.map((field) => [field.key, { value: parseValue(draft[field.key] ?? '', field), updatedAt, source: source() }])) }; const tagNames = tags.filter((tag) => tagIds.includes(tag.id)).map((tag) => tag.name); await onSave({ ...selected, customFields: nextValues, tagIds, tags: tagNames, updatedAt, updatedBy: actor() }); };
  return <section data-testid="crm-record-values" style={panelStyle}><h3 style={{ marginTop: 0 }}>Details and tags</h3><p style={mutedStyle}>Choose something you have already saved, then add only the details that apply to it.</p>{editableRecords.length === 0 ? <p data-testid="crm-record-values-empty" style={mutedStyle}>There are no saved clients, people, accounts, tasks, or opportunities yet.</p> : <><label style={{ display: 'block', marginBottom: 10 }}>What would you like to update?<select data-testid="crm-record-values-select" value={recordId} onChange={(event) => { setRecordId(event.target.value); }}><option value="">Choose something saved</option>{editableRecords.map((record) => <option key={record.id} value={record.id}>{recordLabel(record)} ({savedItemType(record.kind)})</option>)}</select></label>{selected && <>{applicable.length === 0 ? <p style={mutedStyle}>No active custom fields apply to this item.</p> : applicable.map((field) => <label key={field.id} style={{ display: 'block', marginBottom: 8 }}>{field.label}{field.fieldType === 'bool' ? <select data-testid={`crm-record-value-${field.key}`} value={draft[field.key] ?? 'false'} onChange={(event) => { setDraft((current) => ({ ...current, [field.key]: event.target.value })); }}><option value="false">No</option><option value="true">Yes</option></select> : field.fieldType === 'enum' ? <select data-testid={`crm-record-value-${field.key}`} value={draft[field.key] ?? ''} onChange={(event) => { setDraft((current) => ({ ...current, [field.key]: event.target.value })); }}><option value="">Choose one</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : <input data-testid={`crm-record-value-${field.key}`} type={field.fieldType === 'date' ? 'date' : field.fieldType === 'number' || field.fieldType === 'money' ? 'number' : 'text'} value={draft[field.key] ?? ''} placeholder={field.fieldType === 'multi-enum' ? 'Separate choices with commas' : undefined} onChange={(event) => { setDraft((current) => ({ ...current, [field.key]: event.target.value })); }} />}</label>)}<fieldset style={{ border: 0, padding: 0 }}><legend>Tags</legend>{tags.length === 0 ? <p style={mutedStyle}>Create a tag first.</p> : tags.map((tag) => <label key={tag.id} style={{ marginRight: 12 }}><input data-testid={`crm-record-tag-${tag.id}`} type="checkbox" checked={tagIds.includes(tag.id)} onChange={(event) => { setTagIds((current) => event.target.checked ? [...current, tag.id] : current.filter((id) => id !== tag.id)); }} /> {tag.name}</label>)}</fieldset><Button data-testid="crm-record-values-save" style={{ marginTop: 12 }} iconLeft={Save} onClick={() => { void save(); }}>Save details and tags</Button></>}</>}</section>;
}

function FirmSetupContent({ initialTab, onNavigate }: { initialTab: Tab; onNavigate?: (route: string) => void }) {
  const live = useLiveCrmRecords();
  const [tab, setTab] = useState<Tab>(initialTab);
  return <div data-testid="crm-firm-surface" style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)' }}><SurfaceHeader Icon={Users} title="Firm" description="Shared firm setup and labels" />{live.error && <p role="alert">Could not load firm setup: {live.error}</p>}<nav aria-label="Firm sections" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{([{ id: 'setup', label: 'Members and access' }, { id: 'fields', label: 'Custom fields' }, { id: 'tags', label: 'Tags' }, { id: 'values', label: 'Details and tags' }] as const).map((item) => <Button key={item.id} data-testid={`crm-firm-tab-${item.id}`} size="sm" variant={tab === item.id ? 'primary' : 'secondary'} onClick={() => { setTab(item.id); }}><span data-testid={item.id === 'setup' ? 'crm-firm-route-firm-setup' : item.id === 'fields' ? 'crm-firm-route-fields-tags' : undefined}>{item.label}</span></Button>)}</nav>{tab === 'setup' && <><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Button data-testid="crm-firm-route-workspaces" variant="secondary" onClick={() => { onNavigate?.('workspaces'); }}>Firm spaces</Button><Button data-testid="crm-firm-route-intake-links" variant="secondary" onClick={() => { onNavigate?.('intake-links'); }}>Intake links</Button><Button data-testid="crm-firm-route-migration" variant="secondary" onClick={() => { onNavigate?.('migration'); }}>Migration</Button></div><FirmAccessReadModel onSave={live.save} /><MemberDirectory records={live.records} /><EthicalWallNotice /></>}{tab === 'fields' && <FieldsAdmin records={live.records} onSave={live.save} />}{tab === 'tags' && <TagsAdmin records={live.records} onSave={live.save} />}{tab === 'values' && <RecordValues records={live.records} onSave={live.save} />}</div>;
}

export function FirmSetup({ initialTab = 'setup', onNavigate }: { initialTab?: Tab; onNavigate?: (route: string) => void }) {
  return <FirmSetupContent key={initialTab} initialTab={initialTab} {...(onNavigate ? { onNavigate } : {})} />;
}
