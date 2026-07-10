import { useEffect, useMemo, useState } from 'react';

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
  const [unknown, setUnknown] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const current = walkthrough[Math.min(index, Math.max(0, walkthrough.length - 1))];

  useEffect(() => {
    setAnswer('');
    setRangeMin('');
    setRangeMax('');
    setUnknown(false);
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
        if (files.length === 0) throw new Error('Choose a document to file.');
        if (!workspaceService || !matterFolderPath) {
          throw new Error('Open this client folder before filing a document.');
        }
        const paths = await Promise.all(files.map(async (file) => {
          const bytes = new Uint8Array(await file.arrayBuffer());
          return fileIntakeDocument({
            workspaceService,
            matterFolderPath,
            fileName: file.name,
            bytes,
          });
        }));
        markReceived(at, undefined, paths[0]);
      } else if (current.item.t === 'readonly_card') {
        markReceived(at);
      } else {
        const phoneAnswer: PhoneWalkthroughAnswer = unknown
          ? { mode: 'unknown' }
          : current.item.t === 'guided_question' && current.item.response_format === 'range'
            ? { min: rangeMin, max: rangeMax, currency: 'USD' }
            : answer;
        if (!unknown && typeof phoneAnswer === 'string' && !phoneAnswer.trim()) {
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
  const isRange = current.item.t === 'guided_question' && current.item.response_format === 'range';
  const inputType = current.item.t === 'typed_field' && current.item.input === 'ssn'
    ? 'password'
    : current.item.t === 'typed_field' && current.item.input === 'date'
      ? 'date'
      : 'text';

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-testid="phone-walkthrough" className="max-w-xl bg-[var(--kp-surface-card)]">
        <DialogHeader>
          <DialogTitle>Phone walkthrough</DialogTitle>
          <DialogDescription>
            Step {index + 1} of {walkthrough.length}. Enter this with {liveIntake.clientFirstName} on the call.
          </DialogDescription>
        </DialogHeader>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--kp-bg-soft)]" aria-label={`Progress ${index + 1} of ${walkthrough.length}`}>
          <div className="h-full bg-primary transition-all" style={{ width: `${((index + 1) / walkthrough.length) * 100}%` }} />
        </div>
        <section className="grid gap-3 rounded-lg border border-[var(--kp-divider)] bg-background p-4">
          <div className="flex items-center gap-2">
            <h3 className="m-0 text-base font-bold text-[var(--kp-navy)]">{current.item.label}</h3>
            {current.completed ? <span className="rounded-full bg-[var(--kp-success-bg)] px-2 py-1 text-xs font-bold text-[var(--kp-success-text)]">Already provided</span> : null}
          </div>
          {current.item.help_text ? <p className="m-0 text-sm text-muted-foreground">{current.item.help_text}</p> : null}
          {current.item.t === 'guided_question' ? <p className="m-0 text-sm text-[var(--kp-navy)]">{current.item.prompt}</p> : null}
          {current.item.t === 'readonly_card' ? <p className="m-0 text-sm text-[var(--kp-navy)]">{current.item.body}</p> : null}
          {current.item.t === 'doc_upload' ? (
            <label className="grid gap-2 text-sm font-medium text-[var(--kp-navy)]">
              Choose document
              <input aria-label="Choose document" type="file" multiple={(current.item.max_files ?? 1) > 1} accept={current.item.accepted_mime_types?.join(',')} onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
            </label>
          ) : null}
          {current.item.t !== 'doc_upload' && current.item.t !== 'readonly_card' && !isRange ? (
            <label className="grid gap-2 text-sm font-medium text-[var(--kp-navy)]">
              {inputName}
              <input aria-label={inputName} type={inputType} value={answer} placeholder={current.item.t === 'typed_field' ? current.item.placeholder : undefined} onChange={(event) => setAnswer(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3" />
            </label>
          ) : null}
          {isRange ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-2 text-sm font-medium text-[var(--kp-navy)]">Low end<input aria-label="Low end" value={rangeMin} onChange={(event) => setRangeMin(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3" /></label>
              <label className="grid gap-2 text-sm font-medium text-[var(--kp-navy)]">High end<input aria-label="High end" value={rangeMax} onChange={(event) => setRangeMax(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3" /></label>
            </div>
          ) : null}
          {current.item.t === 'guided_question' ? <Button type="button" variant={unknown ? 'secondary' : 'outline'} onClick={() => setUnknown((value) => !value)}>I don&apos;t know yet</Button> : null}
          {error ? <p role="alert" className="m-0 text-sm text-destructive">{error}</p> : null}
        </section>
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => move(-1)} disabled={index === 0 || saving}>Back</Button><Button type="button" variant="ghost" onClick={() => move(1)} disabled={index === walkthrough.length - 1 || saving}>Skip for now</Button></div>
          <Button type="button" onClick={() => { void saveAndContinue(); }} disabled={saving}>{current.canReplace ? 'Replace and continue' : 'Save and continue'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
