import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { intakeFactUpsert } from '@/platform/intake/factsStore';
import { fileIntakeDocument } from '@/platform/intake/intakeFiling';
import { useIntakeStore, type IntakeRecord } from '@/platform/intake/intakeStore';
import {
  buildPhoneFactWrite,
  derivePhoneWalkthroughItems,
  phoneUploadFileNames,
  phoneUploadRules,
  type PhoneWalkthroughAnswer,
} from '@/platform/intake/phoneWalkthrough';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { RequestItem } from '@/platform/intake/types';
import { defaultNewHouseholdItems } from './newHouseholdTemplate';

export interface PhoneWalkthroughProps {
  matterId: string;
  intake: IntakeRecord;
  advisorId: string;
  workspaceService?: WorkspaceService | null | undefined;
  matterFolderPath?: string | undefined;
  initialItemId?: string;
  onClose: () => void;
  onCompleted?: () => void;
}

function fallbackItems(intake: IntakeRecord): RequestItem[] {
  const defaults = defaultNewHouseholdItems();
  return intake.items.map((state) =>
    defaults.find((item) => item.item_id === state.itemId) ?? {
      t: 'typed_field' as const,
      item_id: state.itemId,
      label: state.label,
      help_text: '',
      required: state.state !== 'not_needed',
      subject: 'primary',
      fact_kind: state.itemId === 'income' ? 'income_annual' : state.itemId === 'spending' ? 'spending_monthly' : 'address',
      input: 'text' as const,
    },
  );
}

function phoneProvenance(advisorId: string, at: string) {
  return {
    channel: 'phone_walkthrough' as const,
    label: 'entered by you on a call',
    at,
    enteredBy: advisorId,
    verification: 'advisor_confirmed' as const,
  };
}

function formatByteLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${String(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${String(bytes / 1024)} KB`;
  return `${String(bytes)} bytes`;
}

export function PhoneWalkthrough({
  matterId,
  intake,
  advisorId,
  workspaceService = null,
  matterFolderPath = '',
  initialItemId,
  onClose,
  onCompleted,
}: PhoneWalkthroughProps) {
  const { t } = useTranslation();
  const liveIntake = useIntakeStore((state) => state.intakesById[intake.intakeId]) ?? intake;
  const requestItems = liveIntake.requestItems ?? fallbackItems(liveIntake);
  const walkthrough = useMemo(
    () => derivePhoneWalkthroughItems(requestItems, liveIntake.items),
    [liveIntake.items, requestItems],
  );
  const [index, setIndex] = useState(() => Math.max(0, walkthrough.findIndex((entry) => entry.item.item_id === initialItemId)));
  const [answer, setAnswer] = useState('');
  const [rangeMin, setRangeMin] = useState('');
  const [rangeMax, setRangeMax] = useState('');
  const [guidedAnswerMode, setGuidedAnswerMode] = useState<'amount' | 'range' | 'unknown' | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const current = walkthrough[Math.min(index, Math.max(0, walkthrough.length - 1))];

  useEffect(() => {
    setAnswer('');
    setRangeMin('');
    setRangeMax('');
    setGuidedAnswerMode(null);
    setFiles([]);
    setError('');
  }, [index]);

  const move = (delta: number) => {
    setIndex((currentIndex) => Math.max(0, Math.min(walkthrough.length - 1, currentIndex + delta)));
  };

  const markReceived = (at: string, factId?: string, filePath?: string) => {
    if (!current) return;
    const store = useIntakeStore.getState();
    const checklistItem = current.checklist;
    const provenance = phoneProvenance(advisorId, at);
    store.updateItem(liveIntake.intakeId, {
      ...checklistItem,
      state: 'received',
      provenance,
      ...(factId ? { factId } : {}),
      ...(filePath ? { filePath } : {}),
    });
    store.addReceivedItem(liveIntake.intakeId, {
      itemId: checklistItem.itemId,
      label: checklistItem.label,
      receivedAt: at,
      provenance,
      ...(factId ? { factId } : {}),
      ...(filePath ? { filePath } : {}),
    });
  };

  const saveAndContinue = async () => {
    if (!current) return;
    const at = new Date().toISOString();
    setSaving(true);
    setError('');
    try {
      if (current.item.t === 'doc_upload') {
        const uploadRules = phoneUploadRules(current.item);
        if (files.length === 0) throw new Error('Choose a document to file.');
        if (files.length < uploadRules.requiredFiles) {
          throw new Error(uploadRules.requiredFiles === 2
            ? 'Choose both sides of the driver’s license before filing.'
            : `Choose ${String(uploadRules.requiredFiles)} files before filing.`);
        }
        if (files.length > uploadRules.maxFiles) {
          throw new Error(`Choose no more than ${String(uploadRules.maxFiles)} files.`);
        }
        const oversizedFile = files.find((file) => file.size > uploadRules.maxBytes);
        if (oversizedFile) {
          throw new Error(`${oversizedFile.name} is too large. Choose a file under ${formatByteLimit(uploadRules.maxBytes)}.`);
        }
        if (!workspaceService || !matterFolderPath) {
          throw new Error('Open this client folder before filing a document.');
        }
        const fileNames = phoneUploadFileNames(files);
        const paths = await Promise.all(files.map(async (file, fileIndex) => {
          const fileName = fileNames[fileIndex];
          if (!fileName) throw new Error(t('intake.phone.file-name-error'));
          const bytes = new Uint8Array(await file.arrayBuffer());
          return fileIntakeDocument({
            workspaceService,
            matterFolderPath,
            fileName,
            bytes,
            documentExtraction: {
              matterId,
              requestId: liveIntake.intakeId,
              intakeId: liveIntake.intakeId,
              itemId: current.item.item_id,
              subject: current.item.subject,
              ...(file.type ? { mimeType: file.type } : {}),
            },
          });
        }));
        markReceived(at, undefined, paths[0]);
      } else if (current.item.t === 'readonly_card') {
        markReceived(at);
      } else {
        const phoneAnswer: PhoneWalkthroughAnswer = current.item.t === 'guided_question'
          ? guidedAnswerMode === 'unknown'
            ? { mode: 'unknown' }
            : guidedAnswerMode === 'range'
              ? { mode: 'range', min: rangeMin, max: rangeMax, currency: 'USD' }
              : guidedAnswerMode === 'amount'
                ? { mode: 'amount', amount: answer, currency: 'USD' }
                : ''
          : answer;
        if (current.item.t === 'guided_question' && !guidedAnswerMode) {
          throw new Error('Choose an amount, a range, or “I don’t know yet.”');
        }
        if (guidedAnswerMode !== 'unknown' && typeof phoneAnswer === 'string' && !phoneAnswer.trim()) {
          throw new Error('Enter an answer or choose “I don’t know yet.”');
        }
        const fact = await intakeFactUpsert(buildPhoneFactWrite({
          matterId,
          item: current.item,
          answer: phoneAnswer,
          advisorId,
          at,
        }));
        markReceived(at, fact.fact_id);
      }
      onCompleted?.();
      if (index === walkthrough.length - 1) onClose();
      else move(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this item.');
    } finally {
      setSaving(false);
    }
  };

  if (!current) return null;
  const inputName = current.item.label;
  const isGuidedQuestion = current.item.t === 'guided_question';
  const isRange = isGuidedQuestion && guidedAnswerMode === 'range';
  const isAmount = isGuidedQuestion && guidedAnswerMode === 'amount';
  const uploadRules = current.item.t === 'doc_upload' ? phoneUploadRules(current.item) : null;
  const inputType = current.item.t === 'typed_field' && current.item.input === 'ssn'
    ? 'password'
    : current.item.t === 'typed_field' && current.item.input === 'date'
      ? 'date'
      : 'text';

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-testid="phone-walkthrough" className="max-w-xl bg-[var(--kp-surface-card)]">
        <DialogHeader>
          <DialogTitle>{t('intake.phone.title')}</DialogTitle>
          <DialogDescription>
            {t('intake.phone.step-description', { step: String(index + 1), total: String(walkthrough.length), client: liveIntake.clientFirstName })}
          </DialogDescription>
        </DialogHeader>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--kp-bg-soft)]" aria-label={t('intake.phone.progress', { step: String(index + 1), total: String(walkthrough.length) })}>
          <div className="h-full bg-primary transition-all" style={{ width: `${String(((index + 1) / walkthrough.length) * 100)}%` }} />
        </div>
        <section className="grid gap-3 rounded-lg border border-[var(--kp-divider)] bg-background p-4">
          <div className="flex items-center gap-2">
            <h3 className="m-0 text-base font-bold text-[var(--kp-navy)]">{current.item.label}</h3>
            {current.completed ? <span className="rounded-full bg-[var(--kp-success-bg)] px-2 py-1 text-xs font-bold text-[var(--kp-success-text)]">{t('intake.phone.already-provided')}</span> : null}
          </div>
          {current.item.help_text ? <p className="m-0 text-sm text-muted-foreground">{current.item.help_text}</p> : null}
          {current.item.t === 'guided_question' ? <p className="m-0 text-sm text-[var(--kp-navy)]">{current.item.prompt}</p> : null}
          {current.item.t === 'readonly_card' ? <p className="m-0 text-sm text-[var(--kp-navy)]">{current.item.body}</p> : null}
          {current.item.t === 'doc_upload' ? (
            <label className="grid gap-2 text-sm font-medium text-[var(--kp-navy)]">
              {t('intake.phone.choose-document')}
              <input aria-label={t('intake.phone.choose-document')} type="file" multiple={(uploadRules?.maxFiles ?? 1) > 1} accept={current.item.accepted_mime_types?.join(',')} onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); }} />
            </label>
          ) : null}
          {isGuidedQuestion ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <Button type="button" variant={isAmount ? 'secondary' : 'outline'} aria-pressed={isAmount} onClick={() => { setGuidedAnswerMode('amount'); }}>{t('intake.phone.enter-amount')}</Button>
              <Button type="button" variant={isRange ? 'secondary' : 'outline'} aria-pressed={isRange} onClick={() => { setGuidedAnswerMode('range'); }}>{t('intake.phone.choose-range')}</Button>
              <Button type="button" variant={guidedAnswerMode === 'unknown' ? 'secondary' : 'outline'} aria-pressed={guidedAnswerMode === 'unknown'} onClick={() => { setGuidedAnswerMode('unknown'); }}>{t('intake.phone.unknown-answer')}</Button>
            </div>
          ) : null}
          {current.item.t !== 'doc_upload' && current.item.t !== 'readonly_card' && (!isGuidedQuestion || isAmount) ? (
            <label className="grid gap-2 text-sm font-medium text-[var(--kp-navy)]">
              {isGuidedQuestion ? t('intake.phone.amount') : inputName}
              <input aria-label={isGuidedQuestion ? t('intake.phone.amount') : inputName} type={inputType} value={answer} placeholder={current.item.t === 'typed_field' ? current.item.placeholder : undefined} onChange={(event) => { setAnswer(event.target.value); }} className="h-10 rounded-md border border-input bg-background px-3" />
            </label>
          ) : null}
          {isRange ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-2 text-sm font-medium text-[var(--kp-navy)]">{t('intake.phone.low-amount')}<input aria-label={t('intake.phone.low-amount')} value={rangeMin} onChange={(event) => { setRangeMin(event.target.value); }} className="h-10 rounded-md border border-input bg-background px-3" /></label>
              <label className="grid gap-2 text-sm font-medium text-[var(--kp-navy)]">{t('intake.phone.high-amount')}<input aria-label={t('intake.phone.high-amount')} value={rangeMax} onChange={(event) => { setRangeMax(event.target.value); }} className="h-10 rounded-md border border-input bg-background px-3" /></label>
            </div>
          ) : null}
          {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}
        </section>
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => { move(-1); }} disabled={index === 0 || saving}>{t('intake.phone.back')}</Button><Button type="button" variant="ghost" onClick={() => { move(1); }} disabled={index === walkthrough.length - 1 || saving}>{t('intake.phone.skip-for-now')}</Button></div>
          <Button type="button" onClick={() => { void saveAndContinue().catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : t('intake.phone.save-error')); }); }} disabled={saving}>{current.canReplace ? t('intake.phone.replace-and-continue') : t('intake.phone.save-and-continue')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
