/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  FileText,
  Pencil,
} from 'lucide-react';
import { Badge, Button, Card, TrustNote } from '@/ui/kp';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { cn } from '@/lib/utils';
import { useAcatsReviewStore } from './acatsReviewStore';
import { confidenceLabel, fieldValue, maskAccountNumber } from './format';
import type { AcatsAssetAction, AcatsTransferDraft, AcatsTransferType, ExtractedField } from './types';

interface ReviewFieldProps {
  path: string;
  label: string;
  field: ExtractedField<unknown> | undefined;
  inputTestId: string;
  type?: 'text' | 'date';
}

function SourceLine({ field }: { field: ExtractedField<unknown> | undefined }) {
  if (!field) return <span className="text-xs text-slate-500">No source found</span>;
  return (
    <span className="text-xs text-slate-500">
      Page {field.source.page ?? '?'} | {field.source.extraction} | {confidenceLabel(field.confidence)}
    </span>
  );
}

function ReviewField({ path, label, field, inputTestId, type = 'text' }: ReviewFieldProps) {
  const editField = useAcatsReviewStore((state) => state.editField);
  const confirmField = useAcatsReviewStore((state) => state.confirmField);
  const confirmed = useAcatsReviewStore((state) => Boolean(state.confirmedFields[path]));
  const original = useAcatsReviewStore((state) => state.originalFields[path]);
  const isApprovingDraft = useAcatsReviewStore((state) => state.isApprovingDraft);
  const value = fieldValue(field);

  return (
    <div
      data-testid={`acats-review-field-${path}`}
      className="rounded-md border border-slate-200 bg-white p-3"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <Label className="text-xs font-semibold text-slate-700">{label}</Label>
          <div className="mt-1"><SourceLine field={field} /></div>
        </div>
        <Button
          data-testid={`acats-confirm-${path}`}
          variant={confirmed ? 'secondary' : 'primary'}
          size="sm"
          iconLeft={confirmed ? Check : ClipboardCheck}
          disabled={isApprovingDraft}
          onClick={() => { confirmField(path); }}
        >
          {confirmed ? 'Confirmed' : 'Confirm'}
        </Button>
      </div>
      <Input
        data-testid={inputTestId}
        type={type}
        value={value}
        disabled={isApprovingDraft}
        onChange={(event) => { editField(path, event.target.value); }}
      />
      {original ? (
        <p className="mt-2 text-xs text-slate-500">
          Original: {String(original.value)}
        </p>
      ) : null}
    </div>
  );
}

export function AcatsTransferListRow({ draft }: { draft: AcatsTransferDraft }) {
  return (
    <div
      data-testid={`acats-list-row-${draft.id}`}
      className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900">
          {draft.deliveringFirm.name?.value ?? 'Unknown firm'}
        </p>
        <p data-testid="acats-list-row-account" className="text-xs text-slate-500">
          {maskAccountNumber(draft.deliveringAccount.accountNumber?.value)}
        </p>
      </div>
      <Badge variant={draft.reviewStatus === 'approved' ? 'success' : 'warning'}>
        {draft.reviewStatus === 'approved' ? 'Approved' : 'Needs review'}
      </Badge>
    </div>
  );
}

function RegistrationSelect({ field }: { field: ExtractedField<unknown> | undefined }) {
  const editField = useAcatsReviewStore((state) => state.editField);
  const confirmField = useAcatsReviewStore((state) => state.confirmField);
  const confirmed = useAcatsReviewStore((state) => Boolean(state.confirmedFields['deliveringAccount.registrationType']));
  const original = useAcatsReviewStore((state) => state.originalFields['deliveringAccount.registrationType']);
  const isApprovingDraft = useAcatsReviewStore((state) => state.isApprovingDraft);
  const registrationValue = typeof field?.value === 'string' ? field.value : 'unknown';
  return (
    <div
      data-testid="acats-review-field-deliveringAccount.registrationType"
      className="rounded-md border border-slate-200 bg-white p-3"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <Label className="text-xs font-semibold text-slate-700">Registration</Label>
          <div className="mt-1"><SourceLine field={field} /></div>
        </div>
        <Button
          data-testid="acats-confirm-deliveringAccount.registrationType"
          variant={confirmed ? 'secondary' : 'primary'}
          size="sm"
          iconLeft={confirmed ? Check : ClipboardCheck}
          disabled={isApprovingDraft}
          onClick={() => { confirmField('deliveringAccount.registrationType'); }}
        >
          {confirmed ? 'Confirmed' : 'Confirm'}
        </Button>
      </div>
      <select
        data-testid="acats-field-registration"
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
        value={registrationValue}
        disabled={isApprovingDraft}
        onChange={(event) => { editField('deliveringAccount.registrationType', event.target.value); }}
      >
        <option value="individual">Individual</option>
        <option value="joint">Joint</option>
        <option value="trust">Trust</option>
        <option value="traditional_ira">Traditional IRA</option>
        <option value="roth_ira">Roth IRA</option>
        <option value="rollover_ira">Rollover IRA</option>
        <option value="inherited_ira">Inherited IRA</option>
        <option value="custodial">Custodial</option>
        <option value="tod">TOD</option>
        <option value="unknown">Unknown</option>
      </select>
      {original ? <p className="mt-2 text-xs text-slate-500">Original: {String(original.value)}</p> : null}
    </div>
  );
}

function TransferTypeControl() {
  const draft = useAcatsReviewStore((state) => state.draft);
  const setTransferType = useAcatsReviewStore((state) => state.setTransferType);
  const confirmField = useAcatsReviewStore((state) => state.confirmField);
  const confirmed = useAcatsReviewStore((state) => Boolean(state.confirmedFields['instruction.transferType']));
  const isApprovingDraft = useAcatsReviewStore((state) => state.isApprovingDraft);
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <Label className="text-xs font-semibold text-slate-700">Transfer type</Label>
        <Button
          data-testid="acats-confirm-instruction.transferType"
          variant={confirmed ? 'secondary' : 'primary'}
          size="sm"
          iconLeft={confirmed ? Check : ClipboardCheck}
          disabled={isApprovingDraft}
          onClick={() => { confirmField('instruction.transferType'); }}
        >
          {confirmed ? 'Confirmed' : 'Confirm'}
        </Button>
      </div>
      <select
        data-testid="acats-transfer-type"
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
        value={draft?.instruction.transferType ?? 'unknown'}
        disabled={isApprovingDraft}
        onChange={(event) => { setTransferType(event.target.value as AcatsTransferType); }}
      >
        <option value="unknown">Choose one</option>
        <option value="full">Full transfer</option>
        <option value="partial">Partial transfer</option>
      </select>
    </div>
  );
}

function HoldingsTable({ draft }: { draft: AcatsTransferDraft }) {
  const editField = useAcatsReviewStore((state) => state.editField);
  const setAssetAction = useAcatsReviewStore((state) => state.setAssetAction);
  const isApprovingDraft = useAcatsReviewStore((state) => state.isApprovingDraft);
  return (
    <Card variant="flat" className="overflow-hidden">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Holding</th>
            <th className="px-3 py-2">Symbol</th>
            <th className="px-3 py-2">CUSIP</th>
            <th className="px-3 py-2">Quantity</th>
            <th className="px-3 py-2">Value</th>
            <th className="px-3 py-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {draft.assets.map((asset, index) => {
            const assetIndex = String(index);
            return (
              <tr key={`${asset.description.value}-${assetIndex}`} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <Input
                    data-testid={`acats-asset-${assetIndex}-description`}
                    value={asset.description.value}
                    disabled={isApprovingDraft}
                    onChange={(event) => { editField(`assets.${assetIndex}.description`, event.target.value); }}
                  />
                  <div className="mt-1"><SourceLine field={asset.description} /></div>
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={asset.symbol?.value ?? ''}
                    disabled={isApprovingDraft}
                    onChange={(event) => { editField(`assets.${assetIndex}.symbol`, event.target.value); }}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={asset.cusip?.value ?? ''}
                    disabled={isApprovingDraft}
                    onChange={(event) => { editField(`assets.${assetIndex}.cusip`, event.target.value); }}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={asset.quantity?.value ?? ''}
                    disabled={isApprovingDraft}
                    onChange={(event) => { editField(`assets.${assetIndex}.quantity`, event.target.value); }}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={asset.marketValue?.value ?? ''}
                    disabled={isApprovingDraft}
                    onChange={(event) => { editField(`assets.${assetIndex}.marketValue`, event.target.value); }}
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    data-testid={`acats-asset-${assetIndex}-action`}
                    className="h-10 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                    value={asset.action}
                    disabled={isApprovingDraft}
                    onChange={(event) => { setAssetAction(index, event.target.value as AcatsAssetAction); }}
                  >
                    <option value="unknown">Choose</option>
                    <option value="in_kind">In kind</option>
                    <option value="liquidate">Liquidate</option>
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

export function AcatsReviewScreen({ draft }: { draft: AcatsTransferDraft }) {
  const setDraft = useAcatsReviewStore((state) => state.setDraft);
  const reviewDraft = useAcatsReviewStore((state) => state.draft);
  const acknowledgedWarnings = useAcatsReviewStore((state) => state.acknowledgedWarnings);
  const acknowledgeWarning = useAcatsReviewStore((state) => state.acknowledgeWarning);
  const unacknowledgeWarning = useAcatsReviewStore((state) => state.unacknowledgeWarning);
  const getBlockingItems = useAcatsReviewStore((state) => state.blockingItems);
  const isReadyForApproval = useAcatsReviewStore((state) => state.isReadyForApproval);
  const approveDraft = useAcatsReviewStore((state) => state.approveDraft);
  const isApprovingDraft = useAcatsReviewStore((state) => state.isApprovingDraft);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  // Adjust state during render instead of in an effect (react.dev's own
  // guidance for "reset state when a prop changes"): clears the stale
  // approval error the instant a different draft is passed in, without an
  // extra effect-triggered re-render cascade.
  const [lastDraftId, setLastDraftId] = useState(draft.id);
  if (draft.id !== lastDraftId) {
    setLastDraftId(draft.id);
    setApprovalError(null);
  }

  useEffect(() => {
    // A mounted client review can read this same draft from the shared store.
    // Do not write it straight back on every store update: setDraft clones the
    // object, which would otherwise create an endless render -> clone -> render
    // loop. A different draft id still replaces the active review as expected.
    if (reviewDraft?.id !== draft.id) setDraft(draft);
  }, [draft, reviewDraft?.id, setDraft]);

  const activeDraft = reviewDraft ?? draft;
  const blockingItems = getBlockingItems();
  const ready = isReadyForApproval();

  async function handleApproveDraft(): Promise<void> {
    setApprovalError(null);
    try {
      await approveDraft();
    } catch {
      setApprovalError('The audit log could not be saved, so this draft was not approved. Try again.');
    }
  }

  return (
    <div
      data-testid="acats-review-screen"
      className="flex min-h-0 flex-1 flex-col gap-4 bg-slate-50 p-4 text-slate-900"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <FileText size={14} aria-hidden />
            Account transfer
          </div>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">ACATS transfer review</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Review the statement facts before creating the Schwab prep packet.
          </p>
        </div>
        <Badge variant={activeDraft.reviewStatus === 'approved' ? 'success' : 'warning'}>
          {activeDraft.reviewStatus === 'approved' ? 'Approved' : 'Needs review'}
        </Badge>
      </div>

      <TrustNote variant="default">
        Account numbers are only shown on this review screen and in advisor-approved packet output.
      </TrustNote>

      <div className="grid gap-3 lg:grid-cols-2">
        <ReviewField
          path="deliveringFirm.name"
          label="Delivering firm"
          field={activeDraft.deliveringFirm.name}
          inputTestId="acats-field-delivering-firm"
        />
        <ReviewField
          path="sourceStatementDate"
          label="Statement date"
          field={activeDraft.sourceStatementDate}
          inputTestId="acats-field-statement-date"
          type="date"
        />
        <ReviewField
          path="deliveringAccount.accountNumber"
          label="Account number"
          field={activeDraft.deliveringAccount.accountNumber}
          inputTestId="acats-field-account-number"
        />
        <ReviewField
          path="deliveringAccount.accountTitle"
          label="Account title"
          field={activeDraft.deliveringAccount.accountTitle}
          inputTestId="acats-field-account-title"
        />
        <RegistrationSelect field={activeDraft.deliveringAccount.registrationType} />
        <TransferTypeControl />
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">Holdings</h3>
        <HoldingsTable draft={activeDraft} />
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card variant="raised" className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Pencil size={14} aria-hidden />
            Missing fields
          </div>
          {activeDraft.missingFields.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              {activeDraft.missingFields.map((field) => <li key={field}>{field}</li>)}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">No missing fields found.</p>
          )}
        </Card>

        <Card variant="raised" className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <AlertTriangle size={14} aria-hidden />
            Warnings
          </div>
          {activeDraft.warnings.length ? (
            <div className="space-y-2">
              {activeDraft.warnings.map((warning) => (
                <label
                  key={warning}
                  className={cn(
                    'flex items-start gap-2 rounded-md border p-2 text-sm',
                    acknowledgedWarnings[warning]
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : 'border-amber-200 bg-amber-50 text-amber-900',
                  )}
                >
                  <input
                    data-testid={`acats-warning-${warning}`}
                    type="checkbox"
                    checked={Boolean(acknowledgedWarnings[warning])}
                    disabled={isApprovingDraft}
                    onChange={(event) => {
                      if (event.target.checked) acknowledgeWarning(warning);
                      else unacknowledgeWarning(warning);
                    }}
                  />
                  <span>{warning}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-600">No warnings found.</p>
          )}
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3">
        <div className="min-w-0 text-sm text-slate-600">
          {ready ? 'Transfer packet is ready for advisor approval.' : blockingItems[0] ?? 'Review needed.'}
        </div>
        <Button
          data-testid="acats-approve"
          disabled={!ready || isApprovingDraft}
          iconLeft={ClipboardCheck}
          // eslint-disable-next-line lantern-async/no-silent-failure -- handleApproveDraft has its own try/catch and surfaces the failure via approvalError below
          onClick={() => { void handleApproveDraft(); }}
        >
          {isApprovingDraft ? 'Saving approval...' : 'Approve draft'}
        </Button>
      </div>
      {approvalError ? (
        <div
          role="alert"
          data-testid="acats-approval-error"
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
        >
          {approvalError}
        </div>
      ) : null}
    </div>
  );
}
