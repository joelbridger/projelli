import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { Button, Card, EmptyState, QuietStatus, SegmentedToggle, TrustNote } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import type { AuditEntry } from '@/platform/types/audit';
import type { Matter } from '@/platform/types/matter';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { TranscriptFile } from '@/platform/types/meeting';
import {
  ACCOUNT_APPLICATION_FIELD_MAP,
  AccountType,
  buildAccountApplicationAuditMetadata,
  prefillAccountApplication,
  updateApplicationField,
  type AccountApplicationDraft,
  type AccountDeliveryMode,
  type AccountFieldGroup,
  type AccountFieldKey,
  type MeetingApplicationSummary,
  type AccountCrmContext,
} from './accountApplication';

interface DeliveryResult {
  status: 'done' | 'unavailable' | 'cancelled';
  message: string;
}

export interface NewAccountFlowProps {
  activeMatter: Matter | null;
  crm?: AccountCrmContext;
  meetingSummary?: MeetingApplicationSummary;
  workspaceService?: Pick<WorkspaceService, 'list' | 'readFile'> | null;
  onBack: () => void;
  onGeneratePdf: (draft: AccountApplicationDraft) => Promise<DeliveryResult>;
  onCreateDocusignEnvelope: (draft: AccountApplicationDraft) => Promise<DeliveryResult>;
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
}

type Step = 'types' | 'review' | 'delivery';

const ACCOUNT_TYPES = Object.values(AccountType);

const FIELD_LABEL_KEYS: Record<AccountFieldKey, string> = {
  ownerName: 'accounts.fields.owner-name',
  ownerDob: 'accounts.fields.owner-dob',
  ownerSsn: 'accounts.fields.owner-ssn',
  jointOwnerName: 'accounts.fields.joint-owner-name',
  jointOwnerDob: 'accounts.fields.joint-owner-dob',
  jointOwnerSsn: 'accounts.fields.joint-owner-ssn',
  addressLine1: 'accounts.fields.address-line-1',
  addressLine2: 'accounts.fields.address-line-2',
  city: 'accounts.fields.city',
  state: 'accounts.fields.state',
  postalCode: 'accounts.fields.postal-code',
  phone: 'accounts.fields.phone',
  email: 'accounts.fields.email',
  fundingSource: 'accounts.fields.funding-source',
  beneficiaries: 'accounts.fields.beneficiaries',
  iraContributionYear: 'accounts.fields.ira-contribution-year',
  decedentName: 'accounts.fields.decedent-name',
  decedentDob: 'accounts.fields.decedent-dob',
  trustName: 'accounts.fields.trust-name',
  trustDate: 'accounts.fields.trust-date',
  trusteeName: 'accounts.fields.trustee-name',
  trusteeEmail: 'accounts.fields.trustee-email',
  minorName: 'accounts.fields.minor-name',
  minorDob: 'accounts.fields.minor-dob',
  custodianName: 'accounts.fields.custodian-name',
  custodianSsn: 'accounts.fields.custodian-ssn',
};

const GROUP_LABEL_KEYS: Record<AccountFieldGroup, string> = {
  owner: 'accounts.groups.owner',
  'joint-owner': 'accounts.groups.joint-owner',
  contact: 'accounts.groups.contact',
  funding: 'accounts.groups.funding',
  beneficiaries: 'accounts.groups.beneficiaries',
  trust: 'accounts.groups.trust',
  custodial: 'accounts.groups.custodial',
  inherited: 'accounts.groups.inherited',
};

const SOURCE_LABEL_KEYS: Record<NonNullable<AccountApplicationDraft['fields']['ownerName']['source']>['kind'], string> = {
  matter: 'accounts.sources.matter',
  'crm-household': 'accounts.sources.crm-household',
  'crm-contact': 'accounts.sources.crm-contact',
  'meeting-summary': 'accounts.sources.meeting-summary',
  'meeting-transcript': 'accounts.sources.meeting-transcript',
};

export function NewAccountFlow({
  activeMatter,
  crm,
  meetingSummary,
  workspaceService,
  onBack,
  onGeneratePdf,
  onCreateDocusignEnvelope,
  onAuditLog,
}: NewAccountFlowProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('types');
  const [selectedTypes, setSelectedTypes] = useState<AccountType[]>([AccountType.Individual]);
  const [drafts, setDrafts] = useState<Partial<Record<AccountType, AccountApplicationDraft>>>({});
  const [activeType, setActiveType] = useState<AccountType>(AccountType.Individual);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [busyDelivery, setBusyDelivery] = useState<AccountDeliveryMode | null>(null);
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryResult | null>(null);
  const [scannedMeetingSummary, setScannedMeetingSummary] =
    useState<MeetingApplicationSummary | null>(null);

  const selectedOptions = useMemo(
    () =>
      selectedTypes.map((type) => ({
        value: type,
        label: t(`accounts.types.${type}`),
        testId: `new-account-review-tab-${type}`,
      })),
    [selectedTypes, t],
  );

  const primaryMatterFolder = activeMatter?.folderPaths[0] ?? '';

  useEffect(() => {
    let cancelled = false;
    setScannedMeetingSummary(null);
    if (!workspaceService || !activeMatter || !primaryMatterFolder) return () => {
      cancelled = true;
    };
    loadLatestMeetingSummary(workspaceService, primaryMatterFolder)
      .then((summary) => {
        if (!cancelled) setScannedMeetingSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setScannedMeetingSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeMatter, primaryMatterFolder, workspaceService]);

  const matter = activeMatter;

  if (!matter) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col bg-[var(--color-background)]" data-testid="new-account-flow">
        <FlowHeader onBack={onBack} title={t('accounts.title')} backLabel={t('accounts.back-to-workflows')} />
        <div className="flex flex-1 items-center justify-center p-8">
          <EmptyState
            icon={FileText}
            title={t('accounts.no-client-title')}
            body={t('accounts.no-client-body')}
            data-testid="new-account-no-client"
            actions={
              <Button variant="secondary" onClick={onBack} data-testid="new-account-back-empty">
                {t('accounts.back-to-workflows')}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const scopedMatter: Matter = matter;
  const currentDraft = drafts[activeType];
  const groupedFieldKeys = currentDraft ? groupFieldKeys(currentDraft) : [];

  function toggleType(type: AccountType) {
    setSelectedTypes((current) => {
      if (current.includes(type)) {
        const next = current.filter((item) => item !== type);
        return next.length > 0 ? next : current;
      }
      return [...current, type];
    });
  }

  function startReview() {
    const effectiveMeetingSummary = meetingSummary ?? scannedMeetingSummary ?? undefined;
    const nextDrafts = Object.fromEntries(
      selectedTypes.map((type) => [
        type,
        prefillAccountApplication({
          accountType: type,
          matter: scopedMatter,
          ...(crm ? { crm } : {}),
          ...(effectiveMeetingSummary ? { meetingSummary: effectiveMeetingSummary } : {}),
        }),
      ]),
    ) as Partial<Record<AccountType, AccountApplicationDraft>>;
    setDrafts(nextDrafts);
    setActiveType(selectedTypes[0] ?? AccountType.Individual);
    setReviewConfirmed(false);
    setDeliveryStatus(null);
    setStep('review');
  }

  function updateField(key: AccountFieldKey, value: string) {
    setDrafts((current) => {
      const draft = current[activeType];
      if (!draft) return current;
      return {
        ...current,
        [activeType]: updateApplicationField(draft, key, value),
      };
    });
    setReviewConfirmed(false);
  }

  async function deliver(mode: AccountDeliveryMode) {
    const draft = drafts[activeType];
    if (!draft || !reviewConfirmed) return;
    setBusyDelivery(mode);
    setDeliveryStatus(null);
    try {
      const result = mode === 'pdf'
        ? await onGeneratePdf(draft)
        : await onCreateDocusignEnvelope(draft);
      setDeliveryStatus(result);
      onAuditLog?.({
        action: 'user_action',
        description: t('accounts.audit-description', {
          type: t(`accounts.types.${draft.accountType}`),
          delivery: t(`accounts.delivery.${mode}`),
        }),
        model: undefined,
        inputs: {},
        outputs: {},
        userDecision: result.status === 'done' ? 'approved' : 'rejected',
        metadata: {
          ...buildAccountApplicationAuditMetadata(draft, mode),
          scope: { kind: 'matter', matterId: scopedMatter.id, matterName: scopedMatter.client },
          deliveryStatus: result.status,
        },
      });
    } catch (error) {
      setDeliveryStatus({
        status: 'unavailable',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyDelivery(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-[var(--color-background)]" data-testid="new-account-flow">
      <FlowHeader onBack={onBack} title={t('accounts.title')} backLabel={t('accounts.back-to-workflows')} />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-8 py-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[var(--kp-text)]" data-testid="new-account-client-name">
                {scopedMatter.client || scopedMatter.name}
              </div>
              <div className="text-sm text-[var(--kp-text-dim)]">
                {t('accounts.client-scope-note')}
              </div>
            </div>
            <QuietStatus data-testid="new-account-step-status">
              {t(`accounts.steps.${step}`)}
            </QuietStatus>
          </div>

          {step === 'types' ? (
            <>
              <section aria-labelledby="new-account-type-heading">
                <h2 id="new-account-type-heading" className="mb-3 text-lg font-semibold text-[var(--kp-text)]">
                  {t('accounts.pick-types-title')}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {ACCOUNT_TYPES.map((type) => {
                    const selected = selectedTypes.includes(type);
                    return (
                      <Card
                        key={type}
                        variant="interactive"
                        data-testid={`new-account-type-card-${type}`}
                        style={{
                          borderColor: selected ? 'var(--kp-accent)' : 'var(--kp-divider)',
                          background: selected ? 'var(--kp-surface)' : 'var(--color-background)',
                        }}
                      >
                        <label className="flex cursor-pointer items-start gap-3">
                          <input
                            data-testid={`new-account-type-checkbox-${type}`}
                            type="checkbox"
                            checked={selected}
                            onChange={() => {
                              toggleType(type);
                            }}
                            className="mt-1"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-[var(--kp-text)]">
                              {t(`accounts.types.${type}`)}
                            </span>
                            <span className="mt-1 block text-xs leading-snug text-[var(--kp-text-dim)]">
                              {t(`accounts.type-help.${type}`)}
                            </span>
                          </span>
                        </label>
                      </Card>
                    );
                  })}
                </div>
              </section>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  iconLeft={FileText}
                  onClick={startReview}
                  data-testid="new-account-start-review"
                >
                  {t('accounts.review-fields')}
                </Button>
                <TrustNote data-testid="new-account-prefill-note" icon={ShieldCheck}>
                  {t('accounts.prefill-note')}
                </TrustNote>
              </div>
            </>
          ) : null}

          {step === 'review' && currentDraft ? (
            <>
              {selectedTypes.length > 1 ? (
                <SegmentedToggle
                  options={selectedOptions}
                  value={activeType}
                  onChange={(value) => {
                    setActiveType(value);
                    setReviewConfirmed(false);
                  }}
                  ariaLabel={t('accounts.account-tabs-aria')}
                  data-testid="new-account-review-tabs"
                />
              ) : null}

              <form className="flex flex-col gap-6" data-testid="new-account-review-form">
                {groupedFieldKeys.map(([group, keys]) => (
                  <fieldset key={group} className="rounded-md border border-[var(--kp-divider)] bg-white p-4">
                    <legend className="px-1 text-sm font-semibold text-[var(--kp-text)]">
                      {t(GROUP_LABEL_KEYS[group])}
                    </legend>
                    <div className="grid gap-4 md:grid-cols-2">
                      {keys.map((key) => {
                        const field = currentDraft.fields[key];
                        const fieldId = `new-account-field-${key}`;
                        return (
                          <div
                            key={key}
                            className={field.multiline ? 'md:col-span-2' : ''}
                          >
                            <label htmlFor={fieldId} className="mb-1 block text-sm font-medium text-[var(--kp-text)]">
                              {t(FIELD_LABEL_KEYS[key])}
                            </label>
                            {field.multiline ? (
                              <textarea
                                id={fieldId}
                                data-testid={fieldId}
                                value={field.value}
                                onChange={(event) => {
                                  updateField(key, event.target.value);
                                }}
                                rows={3}
                                className="w-full rounded-md border border-[var(--kp-divider)] bg-white px-3 py-2 text-sm text-[var(--kp-text)] outline-none focus:border-[var(--kp-accent)]"
                              />
                            ) : (
                              <input
                                id={fieldId}
                                data-testid={fieldId}
                                value={field.value}
                                onChange={(event) => {
                                  updateField(key, event.target.value);
                                }}
                                type={field.storage === 'redact-on-store' ? 'password' : 'text'}
                                autoComplete="off"
                                className="h-10 w-full rounded-md border border-[var(--kp-divider)] bg-white px-3 text-sm text-[var(--kp-text)] outline-none focus:border-[var(--kp-accent)]"
                              />
                            )}
                            <div className="mt-1 min-h-4 text-xs text-[var(--kp-text-dim)]">
                              {field.source ? t(SOURCE_LABEL_KEYS[field.source.kind]) : t('accounts.sources.blank')}
                              {field.storage === 'redact-on-store' ? ` ${t('accounts.ssn-redaction-note')}` : ''}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </form>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--kp-divider)] pt-4">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStep('types');
                    setDeliveryStatus(null);
                  }}
                  data-testid="new-account-back-to-types"
                >
                  {t('accounts.change-types')}
                </Button>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--kp-text)]">
                    <input
                      data-testid="new-account-review-confirm"
                      type="checkbox"
                      checked={reviewConfirmed}
                      onChange={(event) => {
                        setReviewConfirmed(event.target.checked);
                      }}
                    />
                    {t('accounts.review-confirm')}
                  </label>
                  <Button
                    iconLeft={CheckCircle2}
                    disabled={!reviewConfirmed}
                    onClick={() => {
                      setStep('delivery');
                      setDeliveryStatus(null);
                    }}
                    data-testid="new-account-continue-delivery"
                  >
                    {t('accounts.choose-delivery')}
                  </Button>
                </div>
              </div>
            </>
          ) : null}

          {step === 'delivery' && currentDraft ? (
            <section className="flex flex-col gap-4" aria-labelledby="new-account-delivery-heading">
              <div>
                <h2 id="new-account-delivery-heading" className="text-lg font-semibold text-[var(--kp-text)]">
                  {t('accounts.delivery-title')}
                </h2>
                <p className="mt-1 text-sm text-[var(--kp-text-dim)]">
                  {t('accounts.delivery-body')}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-[var(--kp-divider)] bg-white p-4">
                  <div className="mb-3 text-sm font-semibold text-[var(--kp-text)]">
                    {t('accounts.pdf-title')}
                  </div>
                  <p className="mb-4 text-sm text-[var(--kp-text-dim)]">
                    {t('accounts.pdf-body')}
                  </p>
                  <Button
                    iconLeft={FileText}
                    loading={busyDelivery === 'pdf'}
                    disabled={!reviewConfirmed || busyDelivery !== null}
                    onClick={() => {
                      deliver('pdf').catch((error: unknown) => {
                        setDeliveryStatus({
                          status: 'unavailable',
                          message: error instanceof Error ? error.message : String(error),
                        });
                        setBusyDelivery(null);
                      });
                    }}
                    data-testid="new-account-generate-pdf"
                  >
                    {t('accounts.generate-pdf')}
                  </Button>
                </div>
                <div className="rounded-md border border-[var(--kp-divider)] bg-white p-4">
                  <div className="mb-3 text-sm font-semibold text-[var(--kp-text)]">
                    {t('accounts.docusign-title')}
                  </div>
                  <p className="mb-4 text-sm text-[var(--kp-text-dim)]">
                    {t('accounts.docusign-body')}
                  </p>
                  <Button
                    iconLeft={Send}
                    variant="secondary"
                    loading={busyDelivery === 'docusign'}
                    disabled={!reviewConfirmed || busyDelivery !== null}
                    onClick={() => {
                      deliver('docusign').catch((error: unknown) => {
                        setDeliveryStatus({
                          status: 'unavailable',
                          message: error instanceof Error ? error.message : String(error),
                        });
                        setBusyDelivery(null);
                      });
                    }}
                    data-testid="new-account-create-docusign"
                  >
                    {t('accounts.create-docusign')}
                  </Button>
                </div>
              </div>
              <TrustNote data-testid="new-account-delivery-note" icon={ShieldCheck}>
                {t('accounts.delivery-trust-note')}
              </TrustNote>
              {deliveryStatus ? (
                <QuietStatus
                  data-testid="new-account-delivery-status"
                  state={deliveryStatus.status === 'done' ? 'ok' : 'failure'}
                >
                  {deliveryStatus.message}
                </QuietStatus>
              ) : null}
              <div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStep('review');
                    setDeliveryStatus(null);
                  }}
                  data-testid="new-account-back-to-review"
                >
                  {t('accounts.back-to-review')}
                </Button>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FlowHeader({
  onBack,
  title,
  backLabel,
}: {
  onBack: () => void;
  title: string;
  backLabel: string;
}) {
  return (
    <div
      data-testid="new-account-header"
      className="shrink-0 border-b border-[var(--kp-divider)] px-6 py-4"
    >
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          iconLeft={ArrowLeft}
          onClick={onBack}
          data-testid="new-account-back"
        >
          <span className="sr-only">{backLabel}</span>
        </Button>
        <SurfaceHeader Icon={FileText} iconColor="var(--kp-accent)" title={title} />
      </div>
    </div>
  );
}

function groupFieldKeys(draft: AccountApplicationDraft): Array<[AccountFieldGroup, AccountFieldKey[]]> {
  const grouped = new Map<AccountFieldGroup, AccountFieldKey[]>();
  for (const field of ACCOUNT_APPLICATION_FIELD_MAP[draft.accountType]) {
    const group = field.group;
    const keys = grouped.get(group) ?? [];
    keys.push(field.key);
    grouped.set(group, keys);
  }
  return Array.from(grouped.entries());
}

async function loadLatestMeetingSummary(
  workspaceService: Pick<WorkspaceService, 'list' | 'readFile'>,
  matterFolder: string,
): Promise<MeetingApplicationSummary | null> {
  const meetingFolders = await workspaceService
    .list(`${matterFolder}/Meetings`)
    .catch(() => []);
  const latest = meetingFolders
    .filter((node) => node.type === 'folder')
    .sort((a, b) => b.name.localeCompare(a.name))[0];
  if (!latest) return null;
  const children = await workspaceService.list(latest.path).catch(() => []);
  const hasTranscript = children.some((node) => node.name === 'transcript.json');
  const hasNotes = children.some((node) => node.name === 'notes.docx' || node.name === 'notes.md' || node.name === 'notes.txt');
  const hasAudio = children.some((node) => node.name === 'audio.wav');
  const meta = await readJsonFile<AccountMeetingJson>(
    workspaceService,
    `${latest.path}/meeting.json`,
  );
  const transcript = hasTranscript
    ? await readJsonFile<TranscriptFile>(workspaceService, `${latest.path}/transcript.json`)
    : null;
  const notesText = await readFirstTextFile(workspaceService, [
    `${latest.path}/notes.md`,
    `${latest.path}/notes.txt`,
  ]);
  const summary: MeetingApplicationSummary = {
    meeting: {
      dir: latest.path,
      folderName: latest.name,
      meta,
      hasNotes,
      hasAudio,
      hasTranscript,
    },
  };
  if (transcript) summary.transcript = transcript;
  if (notesText) summary.notesText = notesText;
  return summary;
}

interface AccountMeetingJson {
  matterId: string;
  startedAt: string;
  calendarTitle?: string;
}

async function readJsonFile<T>(
  workspaceService: Pick<WorkspaceService, 'readFile'>,
  path: string,
): Promise<T | null> {
  // eslint-disable-next-line lantern-async/no-silent-failure -- Optional meeting files may be absent; absence just means no prefill from that source.
  const raw = await workspaceService.readFile(path).catch(() => '');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readFirstTextFile(
  workspaceService: Pick<WorkspaceService, 'readFile'>,
  paths: string[],
): Promise<string | null> {
  for (const path of paths) {
    // eslint-disable-next-line lantern-async/no-silent-failure -- Optional text notes may be absent; absence just means no notes-text prefill.
    const raw = await workspaceService.readFile(path).catch(() => '');
    if (raw.trim()) return raw;
  }
  return null;
}
