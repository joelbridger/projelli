/* eslint-disable lantern-i18n/no-hardcoded-string -- frozen CRM copy */
import { useMemo, useState } from 'react';
import { FileText, Link2, Unlink } from 'lucide-react';
import { Button, Card, EmptyState, SurfaceToolbar } from '@/ui/kp';
import type { HouseholdTabSurfaceProps } from '@/features/crm-clients/tabRegistry';
import type { EntityRef } from '@/platform/crm/types';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import type { FileNode } from '@/platform/types/workspace';
import { EV_OPEN_CRM_DOCUMENT } from '@/config/identity';
import { addDocumentRef, linkedDocumentsForHousehold, recordBelongsToHousehold, removeDocumentRef } from './documentLinks';

type Target = { value: string; kind: 'household' | 'note' | 'task'; id: string; label: string };

function filesIn(tree: readonly FileNode[]): FileNode[] {
  return tree.flatMap((node) => node.type === 'file' ? [node] : filesIn(node.children ?? []));
}

function nameForPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function HouseholdDocumentsTab({ household }: HouseholdTabSurfaceProps) {
  const live = useLiveCrmRecords();
  const tree = useWorkspaceStore((state) => state.fileTree);
  const [targetValue, setTargetValue] = useState('household');
  const [filePath, setFilePath] = useState('');
  const [saving, setSaving] = useState(false);
  const availableFiles = useMemo(() => filesIn(tree), [tree]);
  const fileByPath = useMemo(() => new Map(availableFiles.map((file) => [file.path, file])), [availableFiles]);
  const householdRecord = live.records.find((record) => record.kind === 'household' && record.id === household.id);
  const targets = useMemo<Target[]>(() => [
    { value: 'household', kind: 'household', id: household.id, label: `${household.name} household` },
    ...household.notes.map((note) => ({ value: `embedded-note:${note.id}`, kind: 'note' as const, id: note.id, label: `Note: ${note.body.slice(0, 54) || 'Untitled note'}` })),
    ...live.records.filter((record) => record.kind === 'note' && recordBelongsToHousehold(record, household.id)).map((record) => ({ value: `note:${record.id}`, kind: 'note' as const, id: record.id, label: `Note: ${typeof record['title'] === 'string' ? record['title'] : typeof record['body'] === 'string' ? record['body'].slice(0, 54) : 'Untitled note'}` })),
    ...live.records.filter((record) => record.kind === 'task' && recordBelongsToHousehold(record, household.id)).map((record) => ({ value: `task:${record.id}`, kind: 'task' as const, id: record.id, label: `Task: ${typeof record['title'] === 'string' ? record['title'] : 'Untitled task'}` })),
  ], [household.id, household.name, household.notes, live.records]);
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
      const record = live.records.find((item) => item.id === target.id);
      if (!record) throw new Error('That record is no longer available. Refresh and try again.');
      const key = target.kind === 'note' ? 'links' : 'contextRefs';
      await live.save({ ...record, [key]: change(record[key]) });
    } finally {
      setSaving(false);
    }
  };

  const attach = async () => {
    const target = targets.find((item) => item.value === targetValue);
    const file = fileByPath.get(filePath);
    if (!target || !file) return;
    await mutate(target, (refs) => addDocumentRef(refs, { kind: 'document', id: file.path, label: file.name, matterId: household.id }));
    setFilePath('');
  };
  const detach = async (entry: ReturnType<typeof linkedDocumentsForHousehold>[number]) => {
    const target = targets.find((item) => item.kind === entry.target && item.id === entry.targetId);
    if (target) await mutate(target, (refs) => removeDocumentRef(refs, entry.ref.id));
  };
  const open = (ref: EntityRef) => {
    window.dispatchEvent(new CustomEvent(EV_OPEN_CRM_DOCUMENT, { detail: { path: ref.id, name: ref.label || nameForPath(ref.id) } }));
  };

  return <section data-testid="crm-household-documents" style={{ display: 'grid', gap: 12, marginTop: 14 }}>
    <Card variant="raised">
      <h2>Documents</h2>
      <p>These are links to files already saved in Documents. The CRM does not copy or own another version of a file.</p>
      <SurfaceToolbar>
        <label>Link to <select data-testid="crm-document-target" value={targetValue} onChange={(event) => { setTargetValue(event.target.value); }}>{targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select></label>
        <label>Document <select data-testid="crm-document-file" value={filePath} onChange={(event) => { setFilePath(event.target.value); }}><option value="">Choose a document</option>{availableFiles.map((file) => <option key={file.path} value={file.path}>{file.name}</option>)}</select></label>
        <Button size="sm" iconLeft={Link2} data-testid="crm-document-attach" disabled={!filePath || saving} onClick={() => { void attach(); }}>Link document</Button>
      </SurfaceToolbar>
      {availableFiles.length === 0 ? <p data-testid="crm-documents-no-files">There are no documents in this workspace yet. Add a file in Documents, then come back here to link it.</p> : null}
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
