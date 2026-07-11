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
const overlayFonts = ['Helvetica', 'Times-Roman', 'Courier'] as const;

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

/** New overlay fields start in a visible, distinct grid position. */
export function overlayField(index: number): PdfFieldMapEntry {
  const zeroBased = Math.max(0, index - 1);
  const column = Math.floor(zeroBased / 8) % 2;
  const row = zeroBased % 8;
  return {
    kind: 'overlay', field_id: `field_${String(index)}`, pdf_field_type: 'text', page: 1,
    rect: { x: column === 0 ? 0.08 : 0.55, y: 0.08 + row * 0.11, width: 0.37, height: 0.07 },
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

function canvasFontFamily(family: typeof overlayFonts[number]): string {
  if (family === 'Times-Roman') return 'Times New Roman';
  return family;
}

/** Draw the same reviewed normalized placement the PDF overlay writer uses. */
export function drawOverlayDryFill(
  context: CanvasRenderingContext2D,
  entry: Extract<PdfFieldMapEntry, { kind: 'overlay' }>,
  canvasWidth: number,
  canvasHeight: number,
  value = dryFillText(entry),
): void {
  const x = entry.rect.x * canvasWidth;
  const y = entry.rect.y * canvasHeight;
  const width = entry.rect.width * canvasWidth;
  const height = entry.rect.height * canvasHeight;
  const scale = canvasHeight / 792; // PDF points at the default letter-page height.
  const lineHeight = Math.max(1, entry.font.size * scale * 1.2);
  const startX = entry.alignment === 'left' ? x : entry.alignment === 'center' ? x + width / 2 : x + width;

  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.fillStyle = entry.font.color ?? '#111827';
  context.font = `${String(entry.font.size * scale)}px ${canvasFontFamily(entry.font.family)}`;
  context.textAlign = entry.alignment;
  context.textBaseline = 'top';
  const words = value.split(/\s+/u);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  const visibleLines = entry.overflow === 'stop' ? lines.slice(0, 1) : lines;
  visibleLines.forEach((lineText, index) => {
    if (index * lineHeight + lineHeight <= height) context.fillText(lineText, startX, y + index * lineHeight, width);
  });
  context.restore();
}

function PdfPagePreview({ bytes, descriptor }: { bytes: Uint8Array; descriptor: PdfTemplateDescriptor }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [message, setMessage] = useState('Loading first page preview…');
  const [pageCount, setPageCount] = useState(1);
  const [previewPage, setPreviewPage] = useState(1);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { getDocument } = await import('pdfjs-dist');
        const task = getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true, disableAutoFetch: true, disableRange: true, useWorkerFetch: false, stopAtErrors: true });
        const pdf = await task.promise;
        const selectedPage = Math.min(previewPage, pdf.numPages);
        setPageCount(pdf.numPages);
        if (selectedPage !== previewPage) setPreviewPage(selectedPage);
        const page = await pdf.getPage(selectedPage);
        const viewport = page.getViewport({ scale: 0.8 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        if (!context) return;
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        for (const entry of Object.values(descriptor.fields)) {
          if (entry.kind === 'overlay' && entry.page === selectedPage) drawOverlayDryFill(context, entry, canvas.width, canvas.height);
        }
        if (!cancelled) setMessage(descriptor.kind === 'overlay'
          ? `${String(pdf.numPages)} page${pdf.numPages === 1 ? '' : 's'} checked locally. Sample overlay values are drawn on the selected page.`
          : `${String(pdf.numPages)} page${pdf.numPages === 1 ? '' : 's'} checked locally. AcroForm values are listed below; their positions are not visually verified here.`);
        await task.destroy();
      } catch {
        if (!cancelled) setMessage('Preview could not be rendered. Please choose a different PDF.');
      }
    })();
    return () => { cancelled = true; };
  }, [bytes, descriptor, previewPage]);
  return <div className="grid gap-2 rounded-md border border-[var(--kp-divider)] p-3">{pageCount > 1 ? <Label htmlFor="pdf-preview-page">Preview page<select id="pdf-preview-page" aria-label="Preview page" value={previewPage} onChange={(event) => setPreviewPage(Number(event.target.value))} className="ml-2 h-9 rounded-md border border-input bg-background px-2">{Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => <option key={page} value={page}>Page {page}</option>)}</select></Label> : null}<canvas ref={canvasRef} className="max-h-80 max-w-full" aria-label="PDF page preview" /><p className="m-0 text-sm text-muted-foreground">{message}</p><div className="grid gap-1 text-xs text-muted-foreground" aria-label="Local dry fill preview">{Object.values(descriptor.fields).map((entry) => <span key={entry.field_id}>{entry.field_id}: {dryFillText(entry)}</span>)}</div></div>;
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
  const updateOverlayField = (
    id: string,
    patch: Partial<Extract<PdfFieldMapEntry, { kind: 'overlay' }>>,
  ) => setFields((current) => {
    const entry = current[id];
    if (!entry || entry.kind !== 'overlay') return current;
    return { ...current, [id]: { ...entry, ...patch } };
  });
  const updateOverlayNumber = (
    id: string,
    group: 'page' | 'rect' | 'font',
    key: 'page' | 'x' | 'y' | 'width' | 'height' | 'size',
    raw: string,
  ) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const entry = fields[id];
    if (!entry || entry.kind !== 'overlay') return;
    if (group === 'page') updateOverlayField(id, { page: Math.max(1, Math.floor(value)) });
    if (group === 'rect' && key !== 'page' && key !== 'size') updateOverlayField(id, { rect: { ...entry.rect, [key]: value } });
    if (group === 'font' && key === 'size') updateOverlayField(id, { font: { ...entry.font, size: value } });
  };
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
    {pending && editableDescriptor ? <div className="grid gap-3 rounded-lg border border-[var(--kp-divider)] bg-background p-4"><p className="m-0 text-sm">Reviewing {pending.fileName} locally. No website address is saved or used.</p><div className="grid gap-2"><Label htmlFor="pdf-template-label">Form label</Label><Input id="pdf-template-label" value={label} onChange={(event) => setLabel(event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="pdf-template-kind">Form type</Label><select id="pdf-template-kind" value={kind} onChange={(event) => { const nextKind = event.target.value as PdfTemplateDescriptor['kind']; setKind(nextKind); setFields(nextKind === 'acroform' ? defaultFields(pending.inspection) : Object.keys(fields).length > 0 ? Object.fromEntries(Object.keys(fields).map((_id, index) => { const field = overlayField(index + 1); return [field.field_id, field]; })) : { field_1: overlayField(1) }); }} className="h-10 rounded-md border border-input bg-background px-3"><option value="acroform">Fillable PDF fields</option><option value="overlay">Manual overlay</option></select></div><div className="grid gap-3">{Object.entries(fields).map(([id, entry]) => <div key={id} className="grid gap-2 rounded border border-[var(--kp-divider)] p-3"><strong>{id}</strong><Label htmlFor={`${id}-type`}>Answer type</Label><select id={`${id}-type`} value={entry.pdf_field_type} onChange={(event) => updateField(id, { pdf_field_type: event.target.value as PdfFieldType, ...((event.target.value === 'radio' || event.target.value === 'select') ? { options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] } : { options: undefined }) } as Partial<PdfFieldMapEntry>)} className="h-10 rounded-md border border-input bg-background px-3">{fieldTypes.map((value) => <option key={value} value={value}>{value}</option>)}</select>{entry.kind === 'overlay' ? <><div className="grid grid-cols-2 gap-2"><Label htmlFor={`${id}-page`}>Page number<Input id={`${id}-page`} aria-label={`${id} page number`} type="number" min="1" step="1" value={entry.page} onChange={(event) => updateOverlayNumber(id, 'page', 'page', event.target.value)} /></Label><Label htmlFor={`${id}-font-size`}>Text size<Input id={`${id}-font-size`} aria-label={`${id} text size`} type="number" min="1" max="72" step="1" value={entry.font.size} onChange={(event) => updateOverlayNumber(id, 'font', 'size', event.target.value)} /></Label><Label htmlFor={`${id}-x`}>Left (0–1)<Input id={`${id}-x`} aria-label={`${id} left`} type="number" min="0.001" max="1" step="0.01" value={entry.rect.x} onChange={(event) => updateOverlayNumber(id, 'rect', 'x', event.target.value)} /></Label><Label htmlFor={`${id}-y`}>Top (0–1)<Input id={`${id}-y`} aria-label={`${id} top`} type="number" min="0.001" max="1" step="0.01" value={entry.rect.y} onChange={(event) => updateOverlayNumber(id, 'rect', 'y', event.target.value)} /></Label><Label htmlFor={`${id}-width`}>Width (0–1)<Input id={`${id}-width`} aria-label={`${id} width`} type="number" min="0.001" max="1" step="0.01" value={entry.rect.width} onChange={(event) => updateOverlayNumber(id, 'rect', 'width', event.target.value)} /></Label><Label htmlFor={`${id}-height`}>Height (0–1)<Input id={`${id}-height`} aria-label={`${id} height`} type="number" min="0.001" max="1" step="0.01" value={entry.rect.height} onChange={(event) => updateOverlayNumber(id, 'rect', 'height', event.target.value)} /></Label></div><Label htmlFor={`${id}-font`}>Font</Label><select id={`${id}-font`} aria-label={`${id} font`} value={entry.font.family} onChange={(event) => updateOverlayField(id, { font: { ...entry.font, family: event.target.value as typeof overlayFonts[number] } })} className="h-10 rounded-md border border-input bg-background px-3">{overlayFonts.map((font) => <option key={font} value={font}>{font}</option>)}</select><Label htmlFor={`${id}-alignment`}>Alignment</Label><select id={`${id}-alignment`} aria-label={`${id} alignment`} value={entry.alignment} onChange={(event) => updateOverlayField(id, { alignment: event.target.value as 'left' | 'center' | 'right' })} className="h-10 rounded-md border border-input bg-background px-3"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select><Label htmlFor={`${id}-overflow`}>Long answers</Label><select id={`${id}-overflow`} value={entry.overflow} onChange={(event) => updateOverlayField(id, { overflow: event.target.value as 'wrap' | 'stop' })} className="h-10 rounded-md border border-input bg-background px-3"><option value="wrap">Wrap inside this field</option><option value="stop">Ask the client to contact the advisor</option></select></> : null}</div>)}{kind === 'overlay' ? <Button type="button" variant="outline" onClick={() => setFields((current) => ({ ...current, [`field_${String(Object.keys(current).length + 1)}`]: overlayField(Object.keys(current).length + 1) }))}>Add overlay field</Button> : null}</div><PdfPagePreview bytes={pending.bytes} descriptor={editableDescriptor} /><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => { void saveDraft(); }}>Save draft</Button><Button type="button" onClick={() => { void approve(); }}>Approve this version</Button></div></div> : null}
    {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}
  </section>;
}
