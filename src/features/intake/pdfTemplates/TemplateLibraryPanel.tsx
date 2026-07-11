import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import {
  inspectPdfTemplate,
  PdfImportError,
  type PdfInspection,
} from '@/platform/intake/pdfTemplates/pdfInspector';
import { sha256Hex } from '@/platform/intake/pdfTemplates/receipt';
import {
  MAX_PDF_TEMPLATE_OUTPUT_BYTES,
  isValidPdfTemplateDescriptor,
} from '@/platform/intake/pdfTemplates/templateValidation';
import type {
  PdfFieldMap,
  PdfFieldMapEntry,
  PdfFieldType,
  PdfTemplateDescriptor,
} from '@/platform/intake/pdfTemplates/templateContract';
import { usePdfTemplateStore } from '@/platform/intake/pdfTemplateStore';
import { starterPdfTemplateSeeds } from './starterTemplates';
import {
  assertDryFillPreview,
  drawOverlayDryFill,
  dryFillText,
  overlayField,
  OVERLAY_FONTS,
} from './templatePreviewUtils';

interface PendingImport {
  fileName: string;
  bytes: Uint8Array;
  hash: string;
  inspection: PdfInspection;
}

export interface TemplateLibraryPanelProps {
  onChoose: (descriptor: PdfTemplateDescriptor) => Promise<void>;
}

const fieldTypes: PdfFieldType[] = [
  'text',
  'date',
  'checkbox',
  'number',
  'money',
  'radio',
  'select',
];

function outputStem(label: string): string {
  const stem = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);
  return stem || 'client-information';
}

function artifactRef(): string {
  const id =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/gu, '')
      : `${String(Date.now())}${String(Math.random())}`.replace(/\D/gu, '');
  return `sealed-artifact:${id.padEnd(16, '0')}`;
}

function defaultFields(inspection: PdfInspection): PdfFieldMap {
  return Object.fromEntries(
    inspection.fields.map((field) => {
      const base = {
        kind: 'acroform' as const,
        field_id: field.name,
        acroform_field: field.name,
      };
      const entry: PdfFieldMapEntry =
        field.type === 'radio' || field.type === 'select'
          ? {
              ...base,
              pdf_field_type: field.type,
              options: field.options ?? [],
            }
          : { ...base, pdf_field_type: field.type };
      return [field.name, entry];
    })
  );
}

function toDescriptor(
  pending: PendingImport,
  label: string,
  fields: PdfFieldMap,
  kind: PdfTemplateDescriptor['kind'],
  templateId: string,
  version = 1
): PdfTemplateDescriptor {
  return {
    templateId,
    version,
    kind,
    sourceSha256: pending.hash,
    sourceArtifactRef: artifactRef(),
    outputFileStem: outputStem(label),
    maxOutputBytes: MAX_PDF_TEMPLATE_OUTPUT_BYTES,
    fields,
  };
}

function PdfPagePreview({
  bytes,
  descriptor,
}: {
  bytes: Uint8Array;
  descriptor: PdfTemplateDescriptor;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [message, setMessage] = useState('Loading first page preview…');
  const [pageCount, setPageCount] = useState(1);
  const [previewPage, setPreviewPage] = useState(1);
  useEffect(() => {
    const abortController = new AbortController();
    const isAborted = () => abortController.signal.aborted;
    const renderPreview = async () => {
      const { getDocument } = await import('pdfjs-dist');
      const task = getDocument({
        data: bytes.slice(),
        isEvalSupported: false,
        disableFontFace: true,
        disableAutoFetch: true,
        disableRange: true,
        useWorkerFetch: false,
        stopAtErrors: true,
      });
      const pdf = await task.promise;
      const selectedPage = Math.min(previewPage, pdf.numPages);
      setPageCount(pdf.numPages);
      if (selectedPage !== previewPage) setPreviewPage(selectedPage);
      const page = await pdf.getPage(selectedPage);
      const viewport = page.getViewport({ scale: 0.8 });
      const canvas = canvasRef.current;
      if (!canvas || abortController.signal.aborted) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');
      if (!context) return;
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      for (const entry of Object.values(descriptor.fields)) {
        if (entry.kind === 'overlay' && entry.page === selectedPage)
          drawOverlayDryFill(context, entry, canvas.width, canvas.height);
      }
      if (!isAborted())
        setMessage(
          descriptor.kind === 'overlay'
            ? `${String(pdf.numPages)} page${pdf.numPages === 1 ? '' : 's'} checked locally. Sample overlay values are drawn on the selected page.`
            : `${String(pdf.numPages)} page${pdf.numPages === 1 ? '' : 's'} checked locally. AcroForm values are listed below; their positions are not visually verified here.`
        );
      await task.destroy();
    };
    void renderPreview().catch(() => {
      if (!abortController.signal.aborted)
        setMessage(
          'Preview could not be rendered. Please choose a different PDF.'
        );
    });
    return () => {
      abortController.abort();
    };
  }, [bytes, descriptor, previewPage]);
  return (
    <div className="grid gap-2 rounded-md border border-[var(--kp-divider)] p-3">
      {pageCount > 1 ? (
        <Label htmlFor="pdf-preview-page">
          Preview page
          <select
            id="pdf-preview-page"
            aria-label="Preview page"
            value={previewPage}
            onChange={(event) => {
              setPreviewPage(Number(event.target.value));
            }}
            className="ml-2 h-9 rounded-md border border-input bg-background px-2"
          >
            {Array.from({ length: pageCount }, (_, index) => index + 1).map(
              (page) => (
                <option key={page} value={page}>
                  Page {page}
                </option>
              )
            )}
          </select>
        </Label>
      ) : null}
      <canvas
        ref={canvasRef}
        className="max-h-80 max-w-full"
        aria-label="PDF page preview"
      />
      <p className="m-0 text-sm text-muted-foreground">{message}</p>
      <div
        className="grid gap-1 text-xs text-muted-foreground"
        aria-label="Local dry fill preview"
      >
        {Object.values(descriptor.fields).map((entry) => (
          <span key={entry.field_id}>
            {entry.field_id}: {dryFillText(entry)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function TemplateLibraryPanel({ onChoose }: TemplateLibraryPanelProps) {
  const { t } = useTranslation();
  const templates = usePdfTemplateStore((state) => state.templatesById);
  const importDraft = usePdfTemplateStore((state) => state.importDraft);
  const updateDraft = usePdfTemplateStore((state) => state.updateDraft);
  const approveVersion = usePdfTemplateStore((state) => state.approveVersion);
  const getApprovedDescriptors = usePdfTemplateStore(
    (state) => state.getApprovedDescriptors
  );
  const [approved, setApproved] = useState<PdfTemplateDescriptor[]>([]);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [label, setLabel] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [kind, setKind] = useState<PdfTemplateDescriptor['kind']>('acroform');
  const [fields, setFields] = useState<PdfFieldMap>({});
  const [draft, setDraft] = useState<PdfTemplateDescriptor | null>(null);
  const [error, setError] = useState('');
  const refreshApproved = async () => {
    setApproved(await getApprovedDescriptors());
  };
  useEffect(() => {
    void refreshApproved().catch((cause: unknown) => {
      setError(
        cause instanceof Error
          ? cause.message
          : 'PDF templates could not be loaded.'
      );
    });
  }, [templates]); // eslint-disable-line react-hooks/exhaustive-deps

  const editableDescriptor = useMemo(
    () =>
      pending && templateId
        ? toDescriptor(
            pending,
            label,
            fields,
            kind,
            templateId,
            draft?.version ?? 1
          )
        : null,
    [pending, label, fields, kind, templateId, draft?.version]
  );

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
      setFields(
        inspection.kind === 'acroform'
          ? defaultFields(inspection)
          : { field_1: overlayField(1) }
      );
      setDraft(null);
    } catch (cause) {
      setError(
        cause instanceof PdfImportError || cause instanceof Error
          ? cause.message
          : 'This PDF could not be imported.'
      );
    }
  };

  const saveDraft = async () => {
    if (!pending || !editableDescriptor) return;
    setError('');
    try {
      const saved = draft
        ? await updateDraft(draft.templateId, editableDescriptor, pending.bytes)
        : await importDraft({
            templateId: editableDescriptor.templateId,
            label,
            descriptor: editableDescriptor,
            sourceBytes: pending.bytes,
          });
      setDraft(saved);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Draft could not be saved.'
      );
    }
  };

  const approve = async () => {
    if (!pending || !editableDescriptor) return;
    setError('');
    try {
      assertDryFillPreview(editableDescriptor);
      if (!isValidPdfTemplateDescriptor(editableDescriptor))
        throw new Error('Review each field before approval.');
      const saved = draft
        ? await updateDraft(draft.templateId, editableDescriptor, pending.bytes)
        : await importDraft({
            templateId: editableDescriptor.templateId,
            label,
            descriptor: editableDescriptor,
            sourceBytes: pending.bytes,
          });
      const approvedDescriptor = await approveVersion(
        saved.templateId,
        saved.version
      );
      setDraft(approvedDescriptor);
      await refreshApproved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Template could not be approved.'
      );
    }
  };

  const updateField = (id: string, patch: Partial<PdfFieldMapEntry>) => {
    setFields((current) => ({
      ...current,
      [id]: { ...current[id], ...patch } as PdfFieldMapEntry,
    }));
  };
  const updateOverlayField = (
    id: string,
    patch: Partial<
      Pick<
        Extract<PdfFieldMapEntry, { kind: 'overlay' }>,
        'page' | 'rect' | 'font' | 'alignment' | 'overflow'
      >
    >
  ) => {
    setFields((current) => {
      const entry = current[id];
      if (!entry || entry.kind !== 'overlay') return current;
      const next: Extract<PdfFieldMapEntry, { kind: 'overlay' }> =
        entry.pdf_field_type === 'radio' || entry.pdf_field_type === 'select'
          ? { ...entry, ...patch, options: entry.options }
          : { ...entry, ...patch };
      return { ...current, [id]: next };
    });
  };
  const updateOverlayNumber = (
    id: string,
    group: 'page' | 'rect' | 'font',
    key: 'page' | 'x' | 'y' | 'width' | 'height' | 'size',
    raw: string
  ) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const entry = fields[id];
    if (!entry || entry.kind !== 'overlay') return;
    if (group === 'page')
      updateOverlayField(id, { page: Math.max(1, Math.floor(value)) });
    if (group === 'rect' && key !== 'page' && key !== 'size')
      updateOverlayField(id, { rect: { ...entry.rect, [key]: value } });
    if (group === 'font' && key === 'size')
      updateOverlayField(id, { font: { ...entry.font, size: value } });
  };
  const installStarters = async () => {
    setError('');
    try {
      for (const starter of await starterPdfTemplateSeeds()) {
        if (templates[starter.descriptor.templateId]) continue;
        await importDraft({
          templateId: starter.descriptor.templateId,
          label: starter.label,
          descriptor: starter.descriptor,
          sourceBytes: starter.sourceBytes,
        });
        await approveVersion(starter.descriptor.templateId, 1);
      }
      await refreshApproved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Starter forms could not be added.'
      );
    }
  };
  return (
    <section className="grid gap-4" aria-label="PDF template library">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-base font-semibold">
          {t('intake.pdf-template-library.approved-forms')}
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void installStarters().catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : 'Starter forms could not be added.');
              });
            }}
          >
            {t('intake.pdf-template-library.add-starter-forms')}
          </Button>
          <Label className="cursor-pointer">
            <span className="sr-only">{t('intake.pdf-template-library.import-form')}</span>
            <Input
              aria-label={t('intake.pdf-template-library.import-form')}
              type="file"
              accept="application/pdf"
              className="max-w-56"
              onChange={(event) => {
                void chooseFile(event.target.files?.[0]).catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : 'This PDF could not be imported.');
                });
              }}
            />
          </Label>
        </div>
      </div>
      {approved.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">
          {t('intake.pdf-template-library.empty-state')}
        </p>
      ) : (
        <div className="grid gap-2">
          {approved.map((descriptor) => (
            <div
              key={`${descriptor.templateId}-${String(descriptor.version)}`}
              className="flex items-center justify-between rounded-md border border-[var(--kp-divider)] p-3"
            >
              <span>Form ready</span>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void onChoose(structuredClone(descriptor)).catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : 'PDF form could not be added to the request.');
                  });
                }}
              >
                {t('intake.pdf-template-library.add-to-request')}
              </Button>
            </div>
          ))}
        </div>
      )}
      {pending && editableDescriptor ? (
        <div className="grid gap-3 rounded-lg border border-[var(--kp-divider)] bg-background p-4">
          <p className="m-0 text-sm">
            {t('intake.pdf-template-library.reviewing-local', { fileName: pending.fileName })}
          </p>
          <div className="grid gap-2">
            <Label htmlFor="pdf-template-label">Form label</Label>
            <Input
              id="pdf-template-label"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pdf-template-kind">Form type</Label>
            <select
              id="pdf-template-kind"
              value={kind}
              onChange={(event) => {
                const nextKind = event.target
                  .value as PdfTemplateDescriptor['kind'];
                setKind(nextKind);
                setFields(
                  nextKind === 'acroform'
                    ? defaultFields(pending.inspection)
                    : Object.keys(fields).length > 0
                      ? Object.fromEntries(
                          Object.keys(fields).map((_id, index) => {
                            const field = overlayField(index + 1);
                            return [field.field_id, field];
                          })
                        )
                      : { field_1: overlayField(1) }
                );
              }}
              className="h-10 rounded-md border border-input bg-background px-3"
            >
              <option value="acroform">{t('intake.pdf-template-library.fillable-fields')}</option>
              <option value="overlay">Manual overlay</option>
            </select>
          </div>
          <div className="grid gap-3">
            {Object.entries(fields).map(([id, entry]) => (
              <div
                key={id}
                className="grid gap-2 rounded border border-[var(--kp-divider)] p-3"
              >
                <strong>{id}</strong>
                <Label htmlFor={`${id}-type`}>Answer type</Label>
                <select
                  id={`${id}-type`}
                  value={entry.pdf_field_type}
                  onChange={(event) => {
                    updateField(id, {
                      pdf_field_type: event.target.value as PdfFieldType,
                      ...(event.target.value === 'radio' ||
                      event.target.value === 'select'
                        ? {
                            options: [
                              { value: 'yes', label: 'Yes' },
                              { value: 'no', label: 'No' },
                            ],
                          }
                        : { options: undefined }),
                    } as Partial<PdfFieldMapEntry>);
                  }}
                  className="h-10 rounded-md border border-input bg-background px-3"
                >
                  {fieldTypes.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                {entry.kind === 'overlay' ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Label htmlFor={`${id}-page`}>
                        Page number
                        <Input
                          id={`${id}-page`}
                          aria-label={`${id} page number`}
                          type="number"
                          min="1"
                          step="1"
                          value={entry.page}
                          onChange={(event) => {
                            updateOverlayNumber(
                              id,
                              'page',
                              'page',
                              event.target.value
                            );
                          }}
                        />
                      </Label>
                      <Label htmlFor={`${id}-font-size`}>
                        Text size
                        <Input
                          id={`${id}-font-size`}
                          aria-label={`${id} text size`}
                          type="number"
                          min="1"
                          max="72"
                          step="1"
                          value={entry.font.size}
                          onChange={(event) => {
                            updateOverlayNumber(
                              id,
                              'font',
                              'size',
                              event.target.value
                            );
                          }}
                        />
                      </Label>
                      <Label htmlFor={`${id}-x`}>
                        Left (0–1)
                        <Input
                          id={`${id}-x`}
                          aria-label={`${id} left`}
                          type="number"
                          min="0.001"
                          max="1"
                          step="0.01"
                          value={entry.rect.x}
                          onChange={(event) => {
                            updateOverlayNumber(
                              id,
                              'rect',
                              'x',
                              event.target.value
                            );
                          }}
                        />
                      </Label>
                      <Label htmlFor={`${id}-y`}>
                        Top (0–1)
                        <Input
                          id={`${id}-y`}
                          aria-label={`${id} top`}
                          type="number"
                          min="0.001"
                          max="1"
                          step="0.01"
                          value={entry.rect.y}
                          onChange={(event) => {
                            updateOverlayNumber(
                              id,
                              'rect',
                              'y',
                              event.target.value
                            );
                          }}
                        />
                      </Label>
                      <Label htmlFor={`${id}-width`}>
                        Width (0–1)
                        <Input
                          id={`${id}-width`}
                          aria-label={`${id} width`}
                          type="number"
                          min="0.001"
                          max="1"
                          step="0.01"
                          value={entry.rect.width}
                          onChange={(event) => {
                            updateOverlayNumber(
                              id,
                              'rect',
                              'width',
                              event.target.value
                            );
                          }}
                        />
                      </Label>
                      <Label htmlFor={`${id}-height`}>
                        Height (0–1)
                        <Input
                          id={`${id}-height`}
                          aria-label={`${id} height`}
                          type="number"
                          min="0.001"
                          max="1"
                          step="0.01"
                          value={entry.rect.height}
                          onChange={(event) => {
                            updateOverlayNumber(
                              id,
                              'rect',
                              'height',
                              event.target.value
                            );
                          }}
                        />
                      </Label>
                    </div>
                    <Label htmlFor={`${id}-font`}>Font</Label>
                    <select
                      id={`${id}-font`}
                      aria-label={`${id} font`}
                      value={entry.font.family}
                      onChange={(event) => {
                        updateOverlayField(id, {
                          font: {
                            ...entry.font,
                            family: event.target
                              .value as (typeof OVERLAY_FONTS)[number],
                          },
                        });
                      }}
                      className="h-10 rounded-md border border-input bg-background px-3"
                    >
                      {OVERLAY_FONTS.map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                    <Label htmlFor={`${id}-alignment`}>Alignment</Label>
                    <select
                      id={`${id}-alignment`}
                      aria-label={`${id} alignment`}
                      value={entry.alignment}
                      onChange={(event) => {
                        updateOverlayField(id, {
                          alignment: event.target.value as
                            | 'left'
                            | 'center'
                            | 'right',
                        });
                      }}
                      className="h-10 rounded-md border border-input bg-background px-3"
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                    <Label htmlFor={`${id}-overflow`}>Long answers</Label>
                    <select
                      id={`${id}-overflow`}
                      value={entry.overflow}
                      onChange={(event) => {
                        updateOverlayField(id, {
                          overflow: event.target.value as 'wrap' | 'stop',
                        });
                      }}
                      className="h-10 rounded-md border border-input bg-background px-3"
                    >
                      <option value="wrap">{t('intake.pdf-template-library.wrap-field')}</option>
                      <option value="stop">
                        {t('intake.pdf-template-library.contact-advisor')}
                      </option>
                    </select>
                  </>
                ) : null}
              </div>
            ))}
            {kind === 'overlay' ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setFields((current) => ({
                    ...current,
                    [`field_${String(Object.keys(current).length + 1)}`]:
                      overlayField(Object.keys(current).length + 1),
                  }));
                }}
              >
                {t('intake.pdf-template-library.add-overlay-field')}
              </Button>
            ) : null}
          </div>
          <PdfPagePreview
            bytes={pending.bytes}
            descriptor={editableDescriptor}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void saveDraft().catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : 'Draft could not be saved.');
                });
              }}
            >
              Save draft
            </Button>
            <Button
              type="button"
              onClick={() => {
                void approve().catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : 'Template could not be approved.');
                });
              }}
            >
              {t('intake.pdf-template-library.approve-version')}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
