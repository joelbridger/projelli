import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { instantiateRequestBlueprint } from '@/platform/intake/blueprintFactory';
import { useBlueprintStore } from '@/platform/intake/blueprintStore';
import { assertValidRequestBlueprint, copyRequestBlueprint } from '@/platform/intake/blueprintValidation';
import { listBuiltInRequestBlueprints } from '@/platform/intake/defaultBlueprints';
import { intakeFactMatchList } from '@/platform/intake/factsStore';
import { resolveAskOnce, type AskOnceResolution } from '@/platform/intake/requestAskOnce';
import { isValidPdfTemplateDescriptor } from '@/platform/intake/pdfTemplates/templateValidation';
import { usePdfTemplateStore } from '@/platform/intake/pdfTemplateStore';
import type { RequestBlueprint } from '@/platform/intake/blueprintTypes';
import type { FormRequest, PdfTemplateDescriptor, RequestItem } from '@/platform/intake/types';
import { TemplateLibraryPanel } from './pdfTemplates/TemplateLibraryPanel';
import { createPdfFillDraftItem } from './pdfTemplates/requestComposerPdf';

type ComposerStep = 'picker' | 'editor' | 'review';

/**
 * The caller binds this to Lane 1's createAdvisorIntake issuer with its
 * relay, firm, and link settings. Keeping that binding outside the dialog
 * makes this component reusable from any existing-client surface.
 */
export type RequestFromClientIssuer = (request: FormRequest) => unknown;

export interface RequestFromClientDialogProps {
  matterId: string;
  clientName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issueRequest: RequestFromClientIssuer;
  /** Optional injection keeps the dialog independently testable and reusable. */
  blueprints?: RequestBlueprint[];
  onIssued?: (request: FormRequest) => void;
}

function newStandingRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `intake_${crypto.randomUUID()}`;
  }
  return `intake_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function unsupportedItem(items: RequestItem[]): RequestItem | undefined {
  return items.find((item) => item.t === 'signature' || (item.t === 'pdf_fill' && (
    !isValidPdfTemplateDescriptor(item.template) || !item.sealed_source_pdf_b64
  )));
}

function copyBlueprints(blueprints: RequestBlueprint[]): RequestBlueprint[] {
  return blueprints.map(copyRequestBlueprint).filter((blueprint) => !blueprint.archived);
}

export function RequestFromClientDialog({
  matterId,
  clientName,
  open,
  onOpenChange,
  issueRequest,
  blueprints,
  onIssued,
}: RequestFromClientDialogProps) {
  const { t } = useTranslation();
  const firmBlueprints = useBlueprintStore((state) => state.firmBlueprintsById);
  const loadSourceBytes = usePdfTemplateStore((state) => state.loadSourceBytes);
  const availableBlueprints = useMemo(
    () => blueprints
      ? copyBlueprints(blueprints)
      : [...listBuiltInRequestBlueprints(), ...Object.values(firmBlueprints)
        .filter((blueprint) => !blueprint.archived)
        .map(copyRequestBlueprint)],
    [blueprints, firmBlueprints],
  );
  const [step, setStep] = useState<ComposerStep>('picker');
  const [selectedBlueprint, setSelectedBlueprint] = useState<RequestBlueprint | null>(null);
  const [draftItems, setDraftItems] = useState<RequestItem[]>([]);
  const [resolution, setResolution] = useState<AskOnceResolution | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [showTemplateLibrary, setShowTemplateLibrary] = useState(false);
  const draftGeneration = useRef(0);

  useEffect(() => {
    if (!open) return;
    draftGeneration.current += 1;
    setStep('picker');
    setSelectedBlueprint(null);
    setDraftItems([]);
    setResolution(null);
    setError('');
    setSending(false);
    setShowTemplateLibrary(false);
  }, [open]);

  const blockedItem = unsupportedItem(draftItems);
  const hasNoVisibleItems = resolution?.visibleItems.length === 0;
  const suppressedLabels = useMemo(() => {
    if (!resolution) return [];
    const labels = new Map(draftItems.map((item) => [item.item_id, item.label]));
    return resolution.suppressed.map((suppression) => ({
      ...suppression,
      label: labels.get(suppression.itemId) ?? 'Request item',
    }));
  }, [draftItems, resolution]);

  const selectBlueprint = (blueprint: RequestBlueprint) => {
    const copy = copyRequestBlueprint(blueprint);
    draftGeneration.current += 1;
    setSelectedBlueprint(copy);
    setDraftItems(copy.items);
    setResolution(null);
    setError('');
    setStep('editor');
  };

  const updateItem = (itemId: string, patch: Partial<RequestItem>) => {
    draftGeneration.current += 1;
    setDraftItems((items) => items.map((item) => item.item_id === itemId ? { ...item, ...patch } as RequestItem : item));
    setResolution(null);
  };

  const removeItem = (itemId: string) => {
    draftGeneration.current += 1;
    setDraftItems((items) => items.filter((item) => item.item_id !== itemId));
    setResolution(null);
  };

  const addApprovedTemplate = async (template: PdfTemplateDescriptor) => {
    if (!isValidPdfTemplateDescriptor(template)) {
      setError('This form is not approved yet. Review and approve it before adding it to a request.');
      return;
    }
    try {
      const sourceBytes = await loadSourceBytes(template.templateId, template.version);
      if (!sourceBytes) {
        setError('This approved PDF is unavailable on this device. It was not added to the request.');
        return;
      }
      const item = await createPdfFillDraftItem(template, sourceBytes);
      draftGeneration.current += 1;
      setDraftItems((items) => [...items, item]);
      setResolution(null);
      setShowTemplateLibrary(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This approved PDF could not be added to the request.');
    }
  };

  const reviewRequest = async () => {
    if (!selectedBlueprint) return;
    const reviewGeneration = draftGeneration.current;
    setError('');
    try {
      assertValidRequestBlueprint({ ...selectedBlueprint, items: draftItems });
      const matches = await intakeFactMatchList(matterId);
      if (reviewGeneration !== draftGeneration.current) return;
      setResolution(resolveAskOnce(draftItems, matches));
      setStep('review');
    } catch (cause) {
      if (reviewGeneration !== draftGeneration.current) return;
      setError(cause instanceof Error ? cause.message : 'This request could not be reviewed.');
    }
  };

  const sendRequest = async () => {
    if (!selectedBlueprint || !resolution || resolution.visibleItems.length === 0 || blockedItem || sending) return;
    setError('');
    setSending(true);
    try {
      const request = instantiateRequestBlueprint({
        blueprint: selectedBlueprint,
        requestId: newStandingRequestId(),
        matterId,
        kind: 'standing',
        items: resolution.visibleItems,
      });
      await issueRequest(request);
      onIssued?.(request);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This request could not be sent.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-[var(--kp-surface-card)]" data-testid="request-from-client-dialog">
        <DialogHeader>
          <DialogTitle>Request from {clientName}</DialogTitle>
          <DialogDescription>
            {step === 'picker'
              ? 'Choose a saved request blueprint.'
              : step === 'editor'
                ? 'Adjust the client-facing wording, then review what will be sent.'
                : 'Review this request before sending it.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'picker' ? (
          <section className="grid gap-3" aria-label="Blueprint picker">
            {availableBlueprints.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">{t('intake.request-from-client.no-blueprints')}</p>
            ) : availableBlueprints.map((blueprint) => (
              <button
                type="button"
                key={blueprint.blueprintId}
                onClick={() => { selectBlueprint(blueprint); }}
                className="rounded-lg border border-[var(--kp-divider)] bg-background p-4 text-left transition-colors hover:bg-[var(--kp-bg-soft)]"
              >
                <span className="block font-semibold text-[var(--kp-navy)]">{blueprint.label}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{blueprint.items.length} items</span>
              </button>
            ))}
          </section>
        ) : null}

        {step === 'editor' ? (
          <section className="grid max-h-[55vh] gap-4 overflow-y-auto" aria-label="Request item editor">
            <div className="rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] p-3">
              <Button type="button" variant="outline" onClick={() => { setShowTemplateLibrary((visible) => !visible); }}>
                {showTemplateLibrary ? 'Hide PDF form library' : 'Add approved PDF form'}
              </Button>
              {showTemplateLibrary ? <div className="mt-3"><TemplateLibraryPanel onChoose={addApprovedTemplate} /></div> : null}
            </div>
            {draftItems.map((item) => (
              <article key={item.item_id} className="grid gap-3 rounded-lg border border-[var(--kp-divider)] bg-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <strong>{item.label}</strong>
                  <Button type="button" variant="ghost" onClick={() => { removeItem(item.item_id); }}>Remove</Button>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${item.item_id}-label`}>Label</Label>
                  <Input
                    id={`${item.item_id}-label`}
                    value={item.label}
                    onChange={(event) => { updateItem(item.item_id, { label: event.target.value }); }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`${item.item_id}-help`}>Helper text</Label>
                  <Input
                    id={`${item.item_id}-help`}
                    value={item.help_text}
                    onChange={(event) => { updateItem(item.item_id, { help_text: event.target.value }); }}
                  />
                </div>
                {item.t === 'guided_question' ? (
                  <div className="grid gap-2">
                    <Label htmlFor={`${item.item_id}-prompt`}>Question</Label>
                    <Input
                      id={`${item.item_id}-prompt`}
                      value={item.prompt}
                      onChange={(event) => { updateItem(item.item_id, { prompt: event.target.value }); }}
                    />
                  </div>
                ) : null}
                {item.t === 'pdf_fill' ? <p className="m-0 text-sm text-muted-foreground">Form ready</p> : null}
              </article>
            ))}
          </section>
        ) : null}

        {step === 'review' && resolution ? (
          <section className="grid gap-4" aria-label="Request review">
            <div className="grid gap-2">
              <h3 className="m-0 text-base font-semibold">{t('intake.request-from-client.will-be-sent')}</h3>
              {resolution.visibleItems.map((item) => (
                <div key={item.item_id} className="rounded-md border border-[var(--kp-divider)] bg-background px-3 py-2 text-sm">
                  {item.label}
                </div>
              ))}
              {resolution.visibleItems.length === 0 ? (
                <p className="m-0 text-sm text-muted-foreground">{t('intake.request-from-client.nothing-needed')}</p>
              ) : null}
            </div>
            {suppressedLabels.length > 0 ? (
              <div className="grid gap-2">
                <h3 className="m-0 text-base font-semibold">{t('intake.request-from-client.already-on-file')}</h3>
                {suppressedLabels.map((item) => (
                  <div key={item.itemId} className="rounded-md bg-[var(--kp-success-bg)] px-3 py-2 text-sm text-[var(--kp-success-text)]">
                    {t('intake.request-from-client.already-on-file-row', { label: item.label })}
                  </div>
                ))}
              </div>
            ) : null}
            {blockedItem ? (
              <p role="alert" className="m-0 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {t('intake.request-from-client.unsupported-item')}
              </p>
            ) : null}
          </section>
        ) : null}

        {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          {step === 'editor' ? (
            <Button type="button" variant="outline" onClick={() => { setStep('picker'); }}>Back</Button>
          ) : null}
          {step === 'review' ? (
            <Button type="button" variant="outline" onClick={() => { setStep('editor'); }}>Edit request</Button>
          ) : null}
          {step === 'editor' ? (
            // eslint-disable-next-line lantern-async/no-silent-failure -- reviewRequest catches and surfaces every failure via setError; this call cannot itself reject.
            <Button type="button" onClick={() => { void reviewRequest(); }}>Review request</Button>
          ) : null}
          {step === 'review' ? (
            <Button
              type="button"
              disabled={hasNoVisibleItems || Boolean(blockedItem) || sending}
              onClick={() => { void sendRequest(); }} // eslint-disable-line lantern-async/no-silent-failure -- sendRequest catches and surfaces every failure via setError; this call cannot itself reject.
            >
              {sending ? 'Sending…' : 'Send request'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
