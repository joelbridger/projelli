import { useEffect, useMemo, useRef, useState } from 'react';

import type { PdfFillRequestItem, PdfFieldMapEntry } from '@/platform/intake/types';
import { verifySourceBytesAgainstDescriptor } from '@/platform/intake/pdfTemplates/receipt';

import { assertSafeStaticPdf, PdfFillValidationError, preparePdfFillSubmission } from './preparePdfFillSubmission';

type PdfJs = typeof import('pdfjs-dist');

const pdfWorkerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
let pdfjsPromise: Promise<PdfJs> | undefined;

function loadPdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist');
  return pdfjsPromise;
}

const MAX_SOURCE_PAGES = 50;
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

export interface PdfFillScreenProps {
  item: PdfFillRequestItem;
  firmName: string;
  sourceBytes?: Uint8Array;
  draft?: Record<string, string>;
  busy: boolean;
  onDraftChange: (values: Record<string, string>) => void;
  onSubmit: (payload: { kind: 'files'; files: File[]; pdf_completion_receipt: Awaited<ReturnType<typeof preparePdfFillSubmission>>['receipt'] }) => void;
  onSkip: () => void;
}

function fieldLabel(entry: PdfFieldMapEntry): string {
  return entry.field_id.replace(/[_-]+/gu, ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function dateError(entry: PdfFieldMapEntry, value: string): boolean {
  return entry.pdf_field_type === 'date' && Boolean(value) && !/^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function numberError(entry: PdfFieldMapEntry, value: string): boolean {
  return (entry.pdf_field_type === 'number' || entry.pdf_field_type === 'money') && Boolean(value) && !/^-?(?:\d+|\d*\.\d+)$/u.test(value.replace(/[$,\s]/gu, ''));
}

function baseInputType(entry: PdfFieldMapEntry): 'date' | 'text' {
  return entry.pdf_field_type === 'date' ? 'date' : 'text';
}

export function PdfFillScreen({ item, firmName, sourceBytes, draft, busy, onDraftChange, onSubmit, onSkip }: PdfFillScreenProps): JSX.Element {
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...draft }));
  const [renderError, setRenderError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const fields = useMemo(() => Object.values(item.template.fields), [item.template.fields]);
  const requiredMissing = fields.some((entry) => entry.required && !(values[entry.field_id] ?? '').trim());
  const invalid = fields.some((entry) => dateError(entry, values[entry.field_id] ?? '') || numberError(entry, values[entry.field_id] ?? ''));

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<PdfJs['getDocument']> | undefined;
    let documentProxy: Awaited<ReturnType<PdfJs['getDocument']>['promise']> | undefined;
    async function render(): Promise<void> {
      if (!sourceBytes) {
        setRenderError('This form could not be opened securely. Please contact your advisor.');
        return;
      }
      try {
        const pdfjs = await loadPdfjs();
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        await verifySourceBytesAgainstDescriptor(sourceBytes, item.template);
        if (sourceBytes.byteLength > MAX_SOURCE_BYTES) throw new PdfFillValidationError('This form is too large to open safely. Contact your advisor.');
        assertSafeStaticPdf(sourceBytes);
        loadingTask = pdfjs.getDocument({
          data: sourceBytes.slice(),
          disableAutoFetch: true,
          disableFontFace: true,
          stopAtErrors: true,
          isEvalSupported: false,
        });
        documentProxy = await loadingTask.promise;
        if (documentProxy.numPages === 0 || documentProxy.numPages > MAX_SOURCE_PAGES) {
          throw new PdfFillValidationError('This form has too many pages to open safely. Contact your advisor.');
        }
        const host = pagesRef.current;
        if (!host || cancelled) return;
        host.replaceChildren();
        for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
          const page = await documentProxy.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1.25 });
          const canvas = document.createElement('canvas');
          canvas.className = 'pdf-page-canvas';
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.setAttribute('aria-label', `Form page ${String(pageNumber)}`);
          const context = canvas.getContext('2d');
          if (!context) throw new PdfFillValidationError('This browser cannot safely show this form. Contact your advisor.');
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          if (cancelled) return;
          host.append(canvas);
        }
        setRenderError(null);
      } catch {
        if (!cancelled) setRenderError('This form could not be verified or displayed safely. Please contact your advisor.');
      }
    }
    void render();
    return () => {
      cancelled = true;
      loadingTask?.destroy();
      void documentProxy?.destroy();
    };
  }, [item.template, sourceBytes]);

  function update(fieldId: string, value: string): void {
    setValues((current) => {
      const next = { ...current, [fieldId]: value };
      onDraftChange(next);
      return next;
    });
  }

  async function submit(): Promise<void> {
    if (!sourceBytes || busy || requiredMissing || invalid) return;
    setSubmitError(null);
    try {
      const prepared = await preparePdfFillSubmission({ issuedItemId: item.item_id, sourceBytes, template: item.template, values });
      onSubmit({ kind: 'files', files: [prepared.file], pdf_completion_receipt: prepared.receipt });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'We could not check this form. Please contact your advisor.');
    }
  }

  return (
    <section className="panel pdf-fill-panel">
      <p className="eyebrow">Secure form</p>
      <h1 tabIndex={-1}>{item.label}</h1>
      <p>{item.help_text || `Complete this form and send it securely to ${firmName}.`}</p>
      <p className="format-help">Your answers stay on this page until they are securely sent to your advisor.</p>
      {renderError ? <p className="document-warning" role="alert">{renderError}</p> : <div className="pdf-pages" ref={pagesRef} aria-label="Form preview" />}
      <div className="pdf-fields" aria-label="Form fields">
        {fields.map((entry) => {
          const id = `${item.item_id}-${entry.field_id}`;
          const value = values[entry.field_id] ?? '';
          const error = dateError(entry, value) || numberError(entry, value);
          if (entry.pdf_field_type === 'checkbox') {
            return <label className="pdf-checkbox" key={entry.field_id} htmlFor={id}><input id={id} type="checkbox" checked={value === 'true'} onChange={(event) => update(entry.field_id, event.target.checked ? 'true' : 'false')} /> {fieldLabel(entry)}{entry.required ? ' (required)' : ''}</label>;
          }
          if (entry.pdf_field_type === 'radio') {
            return <fieldset className="pdf-choice" key={entry.field_id}><legend>{fieldLabel(entry)}{entry.required ? ' (required)' : ''}</legend>{entry.options.map((option) => <label key={option.value}><input type="radio" name={id} checked={value === option.value} onChange={() => update(entry.field_id, option.value)} /> {option.label}</label>)}</fieldset>;
          }
          if (entry.pdf_field_type === 'select') {
            return <label className="field-label" key={entry.field_id} htmlFor={id}>{fieldLabel(entry)}{entry.required ? ' (required)' : ''}<select id={id} className="text-input" value={value} onChange={(event) => update(entry.field_id, event.target.value)}><option value="">Choose one</option>{entry.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
          }
          return <label className="field-label" key={entry.field_id} htmlFor={id}>{fieldLabel(entry)}{entry.required ? ' (required)' : ''}<input id={id} className="text-input" type={baseInputType(entry)} inputMode={entry.pdf_field_type === 'money' ? 'decimal' : entry.pdf_field_type === 'number' ? 'numeric' : undefined} value={value} aria-invalid={error} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => update(entry.field_id, event.target.value)} />{error ? <span id={`${id}-error`} className="format-help" role="alert">Enter a valid {entry.pdf_field_type === 'date' ? 'date' : 'number'}.</span> : null}</label>;
        })}
      </div>
      {submitError ? <p className="document-warning" role="alert">{submitError}</p> : null}
      <div className="action-row">
        <button className="primary-button" type="button" disabled={busy || Boolean(renderError) || requiredMissing || invalid} onClick={() => void submit()}>{busy ? 'Sending securely...' : 'Send securely to your advisor'}</button>
        {!item.required ? <button className="quiet-button" type="button" disabled={busy} onClick={onSkip}>Skip for now</button> : null}
      </div>
    </section>
  );
}
