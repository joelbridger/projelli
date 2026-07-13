/* eslint-disable lantern-i18n/no-hardcoded-string -- frozen CRM copy */
import { useMemo, useState, type DragEvent } from 'react';
import { FileText, GripVertical, Link2, Unlink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, SurfaceToolbar } from '@/ui/kp';
import type { HouseholdTabSurfaceProps } from '@/features/crm-clients/tabRegistry';
import type { EntityRef } from '@/platform/crm/types';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useMatters } from '@/platform/matter/matterStore';
import { resolveWorkspaceMatterId } from '@/platform/rag/matterResolver';
import type { FileNode } from '@/platform/types/workspace';
import { EV_OPEN_CRM_DOCUMENT } from '@/config/identity';
import { addDocumentRef, isPlausibleClientDocument, linkedDocumentsForHousehold, recordBelongsToHousehold, removeDocumentRef } from './documentLinks';

type Target = { value: string; kind: 'household' | 'person' | 'note' | 'task'; id: string; label: string };

function filesIn(tree: readonly FileNode[]): FileNode[] {
  return tree.flatMap((node) => node.type === 'file' ? [node] : filesIn(node.children ?? []));
}

function nameForPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function HouseholdDocumentsTab({ household }: HouseholdTabSurfaceProps) {
  const { t } = useTranslation();
  const live = useLiveCrmRecords();
  const tree = useWorkspaceStore((state) => state.fileTree);
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const matters = useMatters();
  const [targetValue, setTargetValue] = useState('household');
  const [filePath, setFilePath] = useState('');
  const [saving, setSaving] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const householdRecord = live.records.find((record) => record.kind === 'household' && record.id === household.id);
  const householdMatterId = useMemo(() => {
    const recordedMatterId = householdRecord?.matterId;
    if (recordedMatterId && matters.some((matter) => matter.id === recordedMatterId)) return recordedMatterId;
    return matters.some((matter) => matter.id === household.id) ? household.id : null;
  }, [household.id, householdRecord?.matterId, matters]);
  const availableFiles = useMemo(
    () => householdMatterId
      ? filesIn(tree).filter((file) =>
        isPlausibleClientDocument(file.name)
        && resolveWorkspaceMatterId(file.path, rootPath, matters) === householdMatterId)
      : [],
    [householdMatterId, matters, rootPath, tree]
  );
  const fileByPath = useMemo(() => new Map(availableFiles.map((file) => [file.path, file])), [availableFiles]);
  const targets = useMemo<Target[]>(() => [
    { value: 'household', kind: 'household', id: household.id, label: `${household.name} household` },
    ...[...household.members, ...household.externalParties].map((person) => ({ value: `person:${person.id}`, kind: 'person' as const, id: person.id, label: `Person: ${person.name}` })),
    ...household.notes.map((note) => ({ value: `embedded-note:${note.id}`, kind: 'note' as const, id: note.id, label: `Note: ${note.body.slice(0, 54) || 'Untitled note'}` })),
    ...live.records.filter((record) => record.kind === 'note' && recordBelongsToHousehold(record, household.id)).map((record) => ({ value: `note:${record.id}`, kind: 'note' as const, id: record.id, label: `Note: ${typeof record['title'] === 'string' ? record['title'] : typeof record['body'] === 'string' ? record['body'].slice(0, 54) : 'Untitled note'}` })),
    ...live.records.filter((record) => record.kind === 'task' && recordBelongsToHousehold(record, household.id)).map((record) => ({ value: `task:${record.id}`, kind: 'task' as const, id: record.id, label: `Task: ${typeof record['title'] === 'string' ? record['title'] : 'Untitled task'}` })),
  ], [household.externalParties, household.id, household.members, household.name, household.notes, live.records]);
  const linked = useMemo(() => linkedDocumentsForHousehold(household, live.records), [household, live.records]);

  const mutate = async (target: Target, change: (refs: unknown) => EntityRef[]) => {
    setSaving(true);
    try {
      if (target.value === 'household') {
        if (!householdRecord) throw new Error('This household has not finished loading yet. Try again.');
        await live.save({ ...householdRecord, contextRefs: change(householdRecord['contextRefs']) });
        return;
      }
      if (target.value.startsWith('embedded-note:')) {
        if (!householdRecord) throw new Error('This household has not finished loading yet. Try again.');
        const notes = Array.isArray(householdRecord['notes']) ? householdRecord['notes'] : [];
        await live.save({ ...householdRecord, notes: notes.map((note) => note && typeof note === 'object' && (note as { id?: unknown }).id === target.id ? { ...(note as Record<string, unknown>), links: change((note as Record<string, unknown>)['links']) } : note) });
        return;
      }
      if (target.kind === 'person') {
        if (!householdRecord) throw new Error('This household has not finished loading yet. Try again.');
        const updatePeople = (people: unknown) => Array.isArray(people) ? people.map((person) => person && typeof person === 'object' && (person as { id?: unknown }).id === target.id ? { ...(person as Record<string, unknown>), contextRefs: change((person as Record<string, unknown>)['contextRefs']) } : person) : people;
        await live.save({ ...householdRecord, members: updatePeople(householdRecord['members']), externalParties: updatePeople(householdRecord['externalParties']) });
        return;
      }
      const record = live.records.find((item) => item.id === target.id);
      if (!record) throw new Error('That record is no longer available. Refresh and try again.');
      const key = target.kind === 'note' ? 'links' : 'contextRefs';
      await live.save({ ...record, [key]: change(record[key]) });
    } finally {
      setSaving(false);
    }
  };

  const attach = async (path = filePath) => {
    const target = targets.find((item) => item.value === targetValue);
    const file = fileByPath.get(path);
    if (!target || !file || !householdMatterId) return;
    setError(null);
    setMessage(null);
    try {
      await mutate(target, (refs) => addDocumentRef(refs, { kind: 'document', id: file.path, label: file.name, matterId: householdMatterId }));
      setFilePath('');
      setMessage(`${file.name} is now linked to ${target.label}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The document could not be linked. Try again.');
    }
  };
  const detach = async (entry: ReturnType<typeof linkedDocumentsForHousehold>[number]) => {
    const target = targets.find((item) => item.kind === entry.target && item.id === entry.targetId);
    if (!target) return;
    setError(null);
    setMessage(null);
    try {
      await mutate(target, (refs) => removeDocumentRef(refs, entry.ref.id));
      setMessage(`${entry.ref.label || nameForPath(entry.ref.id)} is no longer linked to ${target.label}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The document link could not be removed. Try again.');
    }
  };
  const open = (ref: EntityRef) => {
    window.dispatchEvent(new CustomEvent(EV_OPEN_CRM_DOCUMENT, { detail: { path: ref.id, name: ref.label || nameForPath(ref.id) } }));
  };

  const isDocumentDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).some((type) => type === 'application/x-lantern-document-path' || type === 'text/plain');
  const dropDocument = (event: DragEvent) => {
    event.preventDefault();
    setDropActive(false);
    const path = event.dataTransfer.getData('application/x-lantern-document-path') || event.dataTransfer.getData('text/plain');
    if (!fileByPath.has(path)) {
      setError('That document is not available in this workspace. Choose a saved document below instead.');
      return;
    }
    void attach(path);
  };

  return <section data-testid="crm-household-documents" style={{ display: 'grid', gap: 12, marginTop: 14 }}>
    <Card variant="raised">
      <h2>Documents</h2>
      <p>These are links to files already saved in Documents. There is one original file, not a copy tucked away in the CRM.</p>
      <SurfaceToolbar>
        <label>Link to <select data-testid="crm-document-target" value={targetValue} onChange={(event) => { setTargetValue(event.target.value); }}>{targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label>
        <label>Document <select data-testid="crm-document-file" value={filePath} onChange={(event) => { setFilePath(event.target.value); }}><option value="">Choose a document</option>{availableFiles.map((file) => <option key={file.path} value={file.path}>{file.name}</option>)}</select></label>
        <Button size="sm" iconLeft={Link2} data-testid="crm-document-attach" disabled={!fileByPath.has(filePath) || saving} onClick={() => { void attach(); }}>Link document</Button>
      </SurfaceToolbar>
      {availableFiles.length === 0 ? <p data-testid="crm-documents-no-files">{householdMatterId ? t('crm.documents.no-client-files') : t('crm.documents.folder-not-ready')}</p> : null}
      {availableFiles.length ? <>
        <div
          data-testid="crm-document-dropzone"
          aria-label="Drop a saved document here to link it"
          onDragOver={(event) => { if (isDocumentDrag(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'link'; setDropActive(true); } }}
          onDragLeave={() => { setDropActive(false); }}
          onDrop={dropDocument}
          style={{ border: `2px dashed ${dropActive ? 'var(--kp-blue)' : 'var(--kp-border)'}`, borderRadius: 10, padding: 14, marginTop: 12, background: dropActive ? 'var(--kp-accent-soft)' : 'transparent' }}
        >
          <strong>{dropActive ? 'Release to link this document' : 'Drag a saved document here to link it'}</strong>
          <p style={{ margin: '4px 0 0' }}>It will link to the choice above. You can also choose a document and use the button.</p>
        </div>
        <div aria-label="Saved documents you can drag to link" style={{ display: 'grid', gap: 6, marginTop: 12, maxHeight: 180, overflowY: 'auto' }}>
          {availableFiles.map((file) => <div key={file.path} draggable data-testid={`crm-document-drag-${file.id}`} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'link'; event.dataTransfer.setData('application/x-lantern-document-path', file.path); event.dataTransfer.setData('text/plain', file.path); }} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', border: '1px solid var(--kp-border)', borderRadius: 7, background: 'white', cursor: 'grab' }}><GripVertical size={15} aria-hidden="true" style={{ color: 'var(--kp-text-faint)' }} /><span>{file.name}</span></div>)}
        </div>
      </> : null}
      {message ? <p role="status" data-testid="crm-document-link-status">{message}</p> : null}
      {error ? <p role="alert" data-testid="crm-document-link-error">{error}</p> : null}
    </Card>
    {linked.length === 0 ? <EmptyState icon={FileText} title="No linked documents yet" body="Link a saved document to this household, a note, or a task. The original file stays in Documents." /> : linked.map((entry) => {
      const file = fileByPath.get(entry.ref.id);
      const label = entry.ref.label || file?.name || nameForPath(entry.ref.id);
      return <Card key={`${entry.ref.id}:${entry.target}:${entry.targetId}`} variant="raised" data-testid={`crm-linked-document-${entry.target}-${entry.targetId}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><div><strong>{label}</strong><p style={{ marginBottom: 0 }}>{file ? `Linked to ${entry.targetLabel}` : `File is no longer available. It is still linked to ${entry.targetLabel}.`}</p></div><div style={{ display: 'flex', gap: 8 }}><Button size="sm" variant="secondary" data-testid={`crm-document-open-${entry.target}-${entry.targetId}`} disabled={!file} onClick={() => { open(entry.ref); }}>Open document</Button><Button size="sm" variant="secondary" iconLeft={Unlink} data-testid={`crm-document-detach-${entry.target}-${entry.targetId}`} disabled={saving} onClick={() => { void detach(entry); }}>Remove link</Button></div></div>
      </Card>;
    })}
  </section>;
}
