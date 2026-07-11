import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { inspectPdfTemplate, PdfImportError, type PdfInspection } from '@/platform/intake/pdfTemplates/pdfInspector';
import { sha256Hex } from '@/platform/intake/pdfTemplates/receipt';
import { MAX_PDF_TEMPLATE_OUTPUT_BYTES, isValidPdfTemplateDescriptor } from '@/platform/intake/pdfTemplates/templateValidation';
import type { PdfFieldMap, PdfFieldMapEntry, PdfFieldType, PdfTemplateDescriptor } from '@/platform/intake/pdfTemplates/templateContract';
import { usePdfTemplateStore } from '@/platform/intake/pdfTemplateStore';
import { starterPdfTemplateSeeds } from './starterTemplates';

interface PendingImport {
  fileName: string;
  bytes: Uint8Array;
  hash: string;
  inspection: PdfInspection;
}

export interface TemplateLibraryPanelProps {
  onChoose: (descriptor: PdfTemplateDescriptor) => Promise<void>;
}

const fieldTypes: PdfFieldType[] = ['text', 'date', 'checkbox', 'number', 'money', 'radio', 'select'];

function outputStem(label: string): string {
  const stem = label.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 48);
  return stem || 'client-information';
}

function artifactRef(): string {
  const id = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID().replace(/-/gu, '') : `${Date.now()}${Math.random()}`.replace(/\D/gu, '');
  return `sealed-artifact:${id.padEnd(16, '0')}`;
}

function defaultFields(inspection: PdfInspection): PdfFieldMap {
  return Object.fromEntries(inspection.fields.map((field) => [field.name, {
    kind: 'acroform' as const,
    field_id: field.name,
    acroform_field: field.name,
    pdf_field_type: field.type,
    ...(field.options && field.options.length >= 2 ? { options: field.options } : {}),
  }]));
}

function overlayField(index: number): PdfFieldMapEntry {
  return {
    kind: 'overlay', field_id: `field_${String(index)}`, pdf_field_type: 'text', page: 1,
    rect: { x: 0.1, y: 0.1, width: 0.3, height: 0.05 },
    font: { family: 'Helvetica', size: 10 }, alignment: 'left', overflow: 'wrap',
  };
}

function toDescriptor(pending: PendingImport, label: string, fields: PdfFieldMap, kind: PdfTemplateDescriptor['kind'], templateId: string, version = 1): PdfTemplateDescriptor {
  return {
    templateId, version, kind, sourceSha256: pending.hash, sourceArtifactRef: artifactRef(),
    outputFileStem: outputStem(label), maxOutputBytes: MAX_PDF_TEMPLATE_OUTPUT_BYTES, fields,
  };
}

function dryFillText(entry: PdfFieldMapEntry): string {
  if (entry.pdf_field_type === 'checkbox') return '✓';
  if (entry.pdf_field_type === 'money') return '$12,500.00';
  if (entry.pdf_field_type === 'date') return '01/15/2026';
  if (entry.pdf_field_type === 'radio' || entry.pdf_field_type === 'select') return entry.options[0]?.label ?? 'Choice';
  return entry.kind === 'overlay' && entry.overflow === 'stop' ? 'A fitting answer' : 'A sample answer that wraps inside the reviewed field.';
}

/** A local visual map check. It catches omitted fields and invalid overlay placement before approval. */
export function assertDryFillPreview(descriptor: PdfTemplateDescriptor): void {
  const entries = Object.values(descriptor.fields);
  if (entries.length === 0) throw new Error('Add at least one reviewed field before approval.');
  for (const entry of entries) {
    if (!dryFillText(entry)) throw new Error(`Dry fill failed for ${entry.field_id}.`);
    if (entry.kind === 'overlay' && (entry.rect.x + entry.rect.width > 1 || entry.rect.y + entry.rect.height > 1)) {
      throw new Error(`Dry fill is outside the page for ${entry.field_id}.`);
    }
  }
}

/** Deterministic normal-zoom review record used by the synthetic golden tests. */
export function buildDryFillPreviewSnapshot(descriptor: PdfTemplateDescriptor): string {
  return Object.values(descriptor.fields).map((entry) => JSON.stringify({
    field: entry.field_id,
    value: dryFillText(entry),
    ...(entry.kind === 'overlay' ? { page: entry.page, rect: entry.rect, overflow: entry.overflow } : { acroform: entry.acroform_field }),
  })).join('\n');
}

function PdfPagePreview({ bytes, descriptor }: { bytes: Uint8Array; descriptor: PdfTemplateDescriptor }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [message, setMessage] = useState('Loading first page preview…');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { getDocument } = await import('pdfjs-dist');
        const task = getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true, disableAutoFetch: true, disableRange: true, useWorkerFetch: false, stopAtErrors: true });
        const pdf = await task.promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.8 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        if (!context) return;
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        if (!cancelled) setMessage(`${String(pdf.numPages)} page${pdf.numPages === 1 ? '' : 's'} checked locally. Sample values are shown below.`);
        await task.destroy();
      } catch {
        if (!cancelled) setMessage('Preview could not be rendered. Please choose a different PDF.');
      }
    })();
    return () => { cancelled = true; };
  }, [bytes, descriptor.sourceSha256]);
  return <div className="grid gap-2 rounded-md border border-[var(--kp-divider)] p-3"><canvas ref={canvasRef} className="max-h-80 max-w-full" aria-label="PDF first page preview" /><p className="m-0 text-sm text-muted-foreground">{message}</p><div className="grid gap-1 text-xs text-muted-foreground" aria-label="Local dry fill preview">{Object.values(descriptor.fields).map((entry) => <span key={entry.field_id}>{entry.field_id}: {dryFillText(entry)}</span>)}</div></div>;
}

export function TemplateLibraryPanel({ onChoose }: TemplateLibraryPanelProps) {
  const templates = usePdfTemplateStore((state) => state.templatesById);
  const importDraft = usePdfTemplateStore((state) => state.importDraft);
  const updateDraft = usePdfTemplateStore((state) => state.updateDraft);
  const approveVersion = usePdfTemplateStore((state) => state.approveVersion);
  const getApprovedDescriptors = usePdfTemplateStore((state) => state.getApprovedDescriptors);
  const [approved, setApproved] = useState<PdfTemplateDescriptor[]>([]);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [label, setLabel] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [kind, setKind] = useState<PdfTemplateDescriptor['kind']>('acroform');
  const [fields, setFields] = useState<PdfFieldMap>({});
  const [draft, setDraft] = useState<PdfTemplateDescriptor | null>(null);
  const [error, setError] = useState('');
  const refreshApproved = async () => setApproved(await getApprovedDescriptors());
  useEffect(() => { void refreshApproved(); }, [templates]); // eslint-disable-line react-hooks/exhaustive-deps

  const editableDescriptor = useMemo(() => pending && templateId ? toDescriptor(pending, label, fields, kind, templateId, draft?.version ?? 1) : null, [pending, label, fields, kind, templateId, draft?.version]);

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const inspection = await inspectPdfTemplate(bytes);
      const hash = await sha256Hex(bytes);
      setPending({ fileName: file.name, bytes, hash, inspection });
      setLabel(file.name.replace(/\.pdf$/iu, '').replace(/[-_]/gu, ' '));
      setTemplateId(`template_${hash.slice(0, 16)}`);
      setKind(inspection.kind);
      setFields(inspection.kind === 'acroform' ? defaultFields(inspection) : { field_1: overlayField(1) });
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof PdfImportError || cause instanceof Error ? cause.message : 'This PDF could not be imported.');
    }
  };

  const saveDraft = async () => {
    if (!pending || !editableDescriptor) return;
    setError('');
    try {
      const saved = draft
        ? await updateDraft(draft.templateId, editableDescriptor, pending.bytes)
        : await importDraft({ templateId: editableDescriptor.templateId, label, descriptor: editableDescriptor, sourceBytes: pending.bytes });
      setDraft(saved);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Draft could not be saved.'); }
  };

  const approve = async () => {
    if (!pending || !editableDescriptor) return;
    setError('');
    try {
      assertDryFillPreview(editableDescriptor);
      if (!isValidPdfTemplateDescriptor(editableDescriptor)) throw new Error('Review each field before approval.');
      const saved = draft
        ? await updateDraft(draft.templateId, editableDescriptor, pending.bytes)
        : await importDraft({ templateId: editableDescriptor.templateId, label, descriptor: editableDescriptor, sourceBytes: pending.bytes });
      const approvedDescriptor = await approveVersion(saved.templateId, saved.version);
      setDraft(approvedDescriptor);
      await refreshApproved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Template could not be approved.'); }
  };

  const updateField = (id: string, patch: Partial<PdfFieldMapEntry>) => setFields((current) => ({ ...current, [id]: { ...current[id], ...patch } as PdfFieldMapEntry }));
  const installStarters = async () => {
    setError('');
    try {
      for (const starter of await starterPdfTemplateSeeds()) {
        if (templates[starter.descriptor.templateId]) continue;
        await importDraft({ templateId: starter.descriptor.templateId, label: starter.label, descriptor: starter.descriptor, sourceBytes: starter.sourceBytes });
        await approveVersion(starter.descriptor.templateId, 1);
      }
      await refreshApproved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Starter forms could not be added.'); }
  };
  return <section className="grid gap-4" aria-label="PDF template library">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="m-0 text-base font-semibold">Approved PDF forms</h3><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => { void installStarters(); }}>Add starter forms</Button><Label className="cursor-pointer"><span className="sr-only">Import PDF form</span><Input aria-label="Import PDF form" type="file" accept="application/pdf" className="max-w-56" onChange={(event) => { void chooseFile(event.target.files?.[0]); }} /></Label></div></div>
    {approved.length === 0 ? <p className="m-0 text-sm text-muted-foreground">Import a local PDF, review it, then approve it before adding it to a request.</p> : <div className="grid gap-2">{approved.map((descriptor) => <div key={`${descriptor.templateId}-${String(descriptor.version)}`} className="flex items-center justify-between rounded-md border border-[var(--kp-divider)] p-3"><span>Form ready</span><Button type="button" variant="outline" onClick={() => { void onChoose(structuredClone(descriptor)); }}>Add to request</Button></div>)}</div>}
    {pending && editableDescriptor ? <div className="grid gap-3 rounded-lg border border-[var(--kp-divider)] bg-background p-4"><p className="m-0 text-sm">Reviewing {pending.fileName} locally. No website address is saved or used.</p><div className="grid gap-2"><Label htmlFor="pdf-template-label">Form label</Label><Input id="pdf-template-label" value={label} onChange={(event) => setLabel(event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="pdf-template-kind">Form type</Label><select id="pdf-template-kind" value={kind} onChange={(event) => setKind(event.target.value as PdfTemplateDescriptor['kind'])} className="h-10 rounded-md border border-input bg-background px-3"><option value="acroform">Fillable PDF fields</option><option value="overlay">Manual overlay</option></select></div><div className="grid gap-3">{Object.entries(fields).map(([id, entry]) => <div key={id} className="grid gap-2 rounded border border-[var(--kp-divider)] p-3"><strong>{id}</strong><Label htmlFor={`${id}-type`}>Answer type</Label><select id={`${id}-type`} value={entry.pdf_field_type} onChange={(event) => updateField(id, { pdf_field_type: event.target.value as PdfFieldType, ...((event.target.value === 'radio' || event.target.value === 'select') ? { options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] } : { options: undefined }) } as Partial<PdfFieldMapEntry>)} className="h-10 rounded-md border border-input bg-background px-3">{fieldTypes.map((value) => <option key={value} value={value}>{value}</option>)}</select>{entry.kind === 'overlay' ? <><Label htmlFor={`${id}-overflow`}>Long answers</Label><select id={`${id}-overflow`} value={entry.overflow} onChange={(event) => updateField(id, { overflow: event.target.value as 'wrap' | 'stop' })} className="h-10 rounded-md border border-input bg-background px-3"><option value="wrap">Wrap inside this field</option><option value="stop">Ask the client to contact the advisor</option></select></> : null}</div>)}{kind === 'overlay' ? <Button type="button" variant="outline" onClick={() => setFields((current) => ({ ...current, [`field_${String(Object.keys(current).length + 1)}`]: overlayField(Object.keys(current).length + 1) }))}>Add overlay field</Button> : null}</div><PdfPagePreview bytes={pending.bytes} descriptor={editableDescriptor} /><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => { void saveDraft(); }}>Save draft</Button><Button type="button" onClick={() => { void approve(); }}>Approve this version</Button></div></div> : null}
    {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}
  </section>;
}
