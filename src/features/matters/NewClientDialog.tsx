/**
 * NewClientDialog (feedback line 14) — the calm, one-field way to add a client.
 *
 * Creating a client is ONE small modal: a display name (required), nothing else.
 * No folders, no email mapping, no privilege toggle, no helper paragraphs, and
 * NO list of every other client expanded below it — all of that used to live in
 * the create flow (MatterManagerDialog) and made adding a client feel heavy.
 * Enrichment (folders, email, isolation, sharing) now happens INSIDE the client,
 * reachable from its row menu -> "Client settings".
 *
 * On create we land the user INSIDE the new client's Client Map (its Missing
 * panel is the natural next step), by dispatching the same matter-launch event
 * the rail uses.
 *
 * Light theme, lean. The new client still gets its own scoped workspace subfolder
 * by default (matter isolation from the first action) — that happens invisibly;
 * it is not something the user has to think about while creating.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Mail,
  MessageSquare,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { EV_MATTER_LAUNCH } from '@/config/identity';
import { BRAND } from '@/config/brand';
import { useFirmStore } from '@/platform/firm/firmStore';
import { FirmApiClient } from '@/platform/firm/FirmApiClient';
import { publishIntakeKeyToMembers } from '@/platform/intake/intakeKeyShare';
import { useIntakeStore } from '@/platform/intake/intakeStore';
import { IntakeRelayClient } from '@/platform/intake/IntakeRelayClient';
import { createAdvisorIntake } from '@/platform/intake/createIntake';
import { bytesToB64 } from '@/platform/intake/pageSeal';
import type { RequestItem } from '@/platform/intake/types';
import {
  buildNewHouseholdRequest,
  defaultNewHouseholdItems,
  NEW_HOUSEHOLD_NEXT_STEPS,
} from '@/features/intake/newHouseholdTemplate';
import { WhatHappensNextEditor } from '@/features/intake/WhatHappensNextEditor';
import {
  copyWelcomeJourney,
  DEFAULT_WELCOME_JOURNEY,
  loadFirmWelcomeJourneyDefault,
  renderWelcomeJourneyEmail,
  saveFirmWelcomeJourneyDefault,
  type WelcomeJourney,
} from '@/platform/intake/welcomeJourneyDefaults';
import {
  deriveNewClientFolderPath,
  ensureClientFolderOnDisk,
} from './matterManagerDialogHelpers';
import { firmMatterIdForIntakeSharing } from './logic/intakeFirmMatter';

export interface NewClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type NewClientStep = 'details' | 'compose' | 'review';

function newIntakeId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `intake_${crypto.randomUUID()}`;
  }
  return `intake_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function intakeHost(): string {
  const env = (import.meta as { env?: { VITE_INTAKE_HOST?: string } }).env
    ?.VITE_INTAKE_HOST;
  return (env && env.trim()) || 'https://forms.lanternplatform.app';
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function firstName(name: string): string {
  return name.trim().split(/\s+/u)[0] ?? name.trim();
}

function smsCopy(clientName: string, link: string): string {
  return `Hi ${firstName(clientName)}, here is the secure onboarding link we discussed: ${link}`;
}

export function NewClientDialog({ open, onOpenChange }: NewClientDialogProps) {
  const { t } = useTranslation();
  const entityLabel = useEntityLabel();
  const createMatter = useMatterStore((s) => s.createMatter);
  const setClientMapHubTab = useMatterStore((s) => s.setClientMapHubTab);
  const upsertIntake = useIntakeStore((s) => s.upsertIntake);
  const seatToken = useFirmStore((s) => s.seatToken);
  const accessToken = useFirmStore((s) => s.accessToken);
  const firmSession = useFirmStore((s) => s.session);
  const firmId = firmSession?.org?.org_id;
  const firmName = firmSession?.org?.name ?? BRAND.name;
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  // A client is always local. The hosted onboarding link is an optional Firm
  // capability layered on top when this machine has an active Firm seat.
  const canCreateOnboardingLink = Boolean(seatToken);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<NewClientStep>('details');
  const [items, setItems] = useState<RequestItem[]>(() =>
    defaultNewHouseholdItems()
  );
  const [welcomeJourney, setWelcomeJourney] = useState<WelcomeJourney>(() => copyWelcomeJourney(DEFAULT_WELCOME_JOURNEY));
  const [hasFirmWelcomeDefault, setHasFirmWelcomeDefault] = useState(false);
  const [sentLink, setSentLink] = useState('');
  const [createdMatterId, setCreatedMatterId] = useState('');
  const [sendError, setSendError] = useState('');
  const [copied, setCopied] = useState<'link' | 'sms' | null>(null);
  // Re-entrancy guard: a double/triple-clicked Create must create exactly one
  // client (a plain ref takes effect immediately, before React re-renders the
  // disabled button — matching the old MatterManagerDialog guard).
  const [isCreating, setIsCreating] = useState(false);
  const submittingRef = useRef(false);
  const createdMatterRef = useRef<ReturnType<typeof createMatter> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset + focus each time the dialog opens.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the one field when the dialog opens so a reopen starts blank.
      setName('');
      setEmail('');
      setPhone('');
      setStep('details');
      setItems(defaultNewHouseholdItems());
      const firmDefault = loadFirmWelcomeJourneyDefault(firmId);
      setWelcomeJourney(copyWelcomeJourney(firmDefault ?? DEFAULT_WELCOME_JOURNEY));
      setHasFirmWelcomeDefault(Boolean(firmDefault));
      setSentLink('');
      setCreatedMatterId('');
      setSendError('');
      setCopied(null);
      setIsCreating(false);
      submittingRef.current = false;
      createdMatterRef.current = null;
      // Focus after the dialog's own open animation/focus trap settles.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => {
        window.clearTimeout(id);
      };
    }
    return undefined;
  }, [firmId, open]);

  const canReview = name.trim() !== '' && items.length > 0;
  const emailHref = useMemo(() => {
    if (!sentLink) return '';
    const welcomeEmail = renderWelcomeJourneyEmail('welcome', {
      client_first_name: firstName(name), firm_name: firmName, secure_link: sentLink,
      primary_next_item: items.find((item) => item.t !== 'readonly_card')?.label ?? 'the first checklist item',
      advisor_first_name: (firmSession?.email ?? '').split('@')[0] || 'Your advisor',
    });
    const subject = encodeURIComponent(welcomeEmail.subject);
    const body = encodeURIComponent(welcomeEmail.body);
    return `mailto:${encodeURIComponent(email.trim())}?subject=${subject}&body=${body}`;
  }, [email, firmName, firmSession?.email, items, name, sentLink]);

  const moveItem = (itemId: string, direction: -1 | 1) => {
    setItems((current) => {
      const index = current.findIndex((item) => item.item_id === itemId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length)
        return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (!item) return current;
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const updateItemText = (
    itemId: string,
    patch: Partial<Pick<RequestItem, 'label' | 'help_text'>>
  ) => {
    setItems((current) =>
      current.map((item) =>
        item.item_id === itemId ? { ...item, ...patch } : item
      )
    );
  };

  const addChecklistItem = () => {
    const id = `custom_${Date.now().toString(36)}`;
    setItems((current) => [
      ...current,
      {
        t: 'readonly_card',
        item_id: id,
        label: 'New checklist item',
        help_text: '',
        required: false,
        subject: 'household',
        body: 'Add the wording your client should see.',
      },
    ]);
  };

  const handleCreate = () => {
    if (submittingRef.current) return;
    const displayName = name.trim();
    if (!displayName) return;
    submittingRef.current = true;
    setIsCreating(true);
    setSendError('');

    void (async () => {
      let created = createdMatterRef.current;
      if (!created) {
        const takenFolderPaths = useMatterStore
          .getState()
          .matters.flatMap((m) => m.folderPaths);
        const clientFolder = deriveNewClientFolderPath(
          '',
          displayName,
          rootPath,
          takenFolderPaths
        );
        created = createMatter({
          name: displayName,
          client: '',
          ...(clientFolder ? { folderPaths: [clientFolder] } : {}),
        });
        createdMatterRef.current = created;
        setCreatedMatterId(created.id);
        if (clientFolder) {
          void ensureClientFolderOnDisk(clientFolder).catch(
            (error: unknown) => {
              console.warn(
                '[NewClientDialog] Could not prepare client folder:',
                error
              );
            }
          );
        }
      }

      // Solo creation must remain local and account-free. Do this after the
      // common matter setup so Firm users still take the exact existing link
      // issuance and team-key-sharing path below.
      if (!seatToken) {
        setClientMapHubTab('overview');
        window.dispatchEvent(
          new CustomEvent(EV_MATTER_LAUNCH, {
            detail: { matterId: created.id, surface: 'matters' },
          })
        );
        onOpenChange(false);
        return;
      }

      const intakeId = newIntakeId();
      const expiresAt = addDaysIso(30);
      const checklist = buildNewHouseholdRequest({
        requestId: intakeId,
        matterId: created.id,
        items,
      });
      const relay = new IntakeRelayClient({ seatToken, accessToken });
      const firmMatterId = firmMatterIdForIntakeSharing(
        useMatterStore.getState().matters.find((matter) => matter.id === created.id),
      );
      const bundle = await createAdvisorIntake({
        intakeId,
        matterId: created.id,
        intakeHost: intakeHost(),
        expiresAt,
        checklist,
        clientFirstName: firstName(displayName),
        firm: {
          name: firmName,
          accent: BRAND.colors.accent,
          advisor_name: (firmSession?.email ?? '').split('@')[0] || 'Your advisor',
          advisor_email: firmSession?.email ?? BRAND.urls.supportEmail,
          next_steps: [...NEW_HOUSEHOLD_NEXT_STEPS],
          journey: welcomeJourney,
        },
        relay,
        ...(firmSession?.tier === 'practice' && firmSession.activated && firmMatterId
          ? {
              publishTeamKey: async (sharedIntakeId: string) => {
                const client = new FirmApiClient(useFirmStore.getState().tokenSource());
                await publishIntakeKeyToMembers(client, sharedIntakeId, firmMatterId, 1, { firmEntitled: true });
              },
            }
          : {}),
      });

      upsertIntake({
        intakeId,
        matterId: created.id,
        clientFirstName: firstName(displayName),
        ...(email.trim() ? { clientEmail: email.trim() } : {}),
        ...(phone.trim() ? { clientPhone: phone.trim() } : {}),
        firmName,
        status: 'active',
        createdAt: new Date().toISOString(),
        link: bundle.link,
        expiresAt,
        checklistVersion: 1,
        requestItems: checklist.items,
        items: checklist.items.map((item) => ({
          itemId: item.item_id,
          label: item.label,
          state: 'not_started',
        })),
        receivedItems: [],
        flags: [],
        knownSessionIds: [],
        knownSubmissionIds: [],
        nudges: [],
        publicKeyRawB64: bytesToB64(bundle.publicKeyRaw),
        checklistCiphertextB64: bundle.checklistCiphertextB64,
        stateCiphertextB64: bundle.stateCiphertextB64,
      });
      setSentLink(bundle.link);
      setCreatedMatterId(created.id);
      setClientMapHubTab('onboarding');
      window.dispatchEvent(
        new CustomEvent(EV_MATTER_LAUNCH, {
          detail: { matterId: created.id, surface: 'matters' },
        })
      );
    })()
      .catch((error: unknown) => {
        setSendError(
          error instanceof Error
            ? error.message
            : 'Could not create the onboarding link.'
        );
      })
      .finally(() => {
        submittingRef.current = false;
        setIsCreating(false);
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="new-client-dialog" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {step === 'details'
              ? t('matter.new-client.title', { entity: entityLabel.one })
              : step === 'compose'
                ? 'Compose onboarding checklist'
                : 'Review and send'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t('matter.new-client.description', { entity: entityLabel.one })}
          </DialogDescription>
        </DialogHeader>

        {step === 'details' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-client-name">
                {t('matter.new-client.name-label')}
              </Label>
              <Input
                id="new-client-name"
                ref={inputRef}
                data-testid="new-client-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) {
                    e.preventDefault();
                    setStep('compose');
                  }
                }}
                placeholder={t('matter.new-client.name-placeholder')}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-client-email">Email</Label>
                <Input
                  id="new-client-email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                  }}
                  placeholder="client@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-client-phone">Phone</Label>
                <Input
                  id="new-client-phone"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                  }}
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>
          </div>
        )}

        {step === 'compose' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-slate-700">
                {t('matter.new-client.household-template')}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addChecklistItem}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                Add item
              </Button>
            </div>
            <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
              {items.map((item, index) => (
                <div
                  key={item.item_id}
                  className="rounded-md border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-start gap-2">
                    <div className="mt-2 w-6 shrink-0 text-center text-xs font-bold text-slate-400">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <Input
                        value={item.label}
                        onChange={(e) => {
                          updateItemText(item.item_id, {
                            label: e.target.value,
                          });
                        }}
                        aria-label="Item label"
                      />
                      <Input
                        value={item.help_text}
                        onChange={(e) => {
                          updateItemText(item.item_id, {
                            help_text: e.target.value,
                          });
                        }}
                        aria-label="Item help text"
                        placeholder="Optional helper text"
                      />
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Move item up"
                        onClick={() => {
                          moveItem(item.item_id, -1);
                        }}
                        disabled={index === 0}
                      >
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Move item down"
                        onClick={() => {
                          moveItem(item.item_id, 1);
                        }}
                        disabled={index === items.length - 1}
                      >
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove item"
                        onClick={() => {
                          setItems((current) =>
                            current.filter(
                              (candidate) => candidate.item_id !== item.item_id
                            )
                          );
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <details className="rounded-md border border-slate-200 bg-white p-3" open={!hasFirmWelcomeDefault}>
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Welcome journey</summary>
              <div className="mt-3">
                <WhatHappensNextEditor
                  value={welcomeJourney}
                  onChange={setWelcomeJourney}
                  {...(firmId ? { onSaveDefault: (next: WelcomeJourney) => { saveFirmWelcomeJourneyDefault(firmId, next); setWelcomeJourney(next); setHasFirmWelcomeDefault(true); } } : {})}
                />
              </div>
            </details>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                {firmName}
              </div>
              <div className="mt-2 text-lg font-bold text-slate-900">
                {t('matter.new-client.review-greeting', {
                  name: firstName(name),
                })}
              </div>
              {canCreateOnboardingLink ? (
                <>
                  <div className="mt-1 text-sm text-slate-600">
                    {t('matter.new-client.review-link-note')}
                  </div>
                  <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">
                    {sentLink ||
                      'The private link will appear here after you create it.'}
                  </div>
                </>
              ) : (
                <div className="mt-1 text-sm text-slate-600">
                  {t('matter.new-client.solo-note', { entity: entityLabel.one })}
                </div>
              )}
            </div>
            {sendError ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {sendError}
              </div>
            ) : null}
            {sentLink ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(sentLink)
                      .then(() => {
                        setCopied('link');
                      })
                      .catch((error: unknown) => {
                        setSendError(
                          error instanceof Error
                            ? error.message
                            : 'Could not copy the link.'
                        );
                      });
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" aria-hidden />
                  {copied === 'link' ? 'Copied' : 'Copy link'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    window.location.href = emailHref;
                  }}
                  disabled={!emailHref}
                >
                  <Mail className="mr-2 h-4 w-4" aria-hidden />
                  {t('matter.new-client.open-email-draft')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(smsCopy(name, sentLink))
                      .then(() => {
                        setCopied('sms');
                      })
                      .catch((error: unknown) => {
                        setSendError(
                          error instanceof Error
                            ? error.message
                            : 'Could not copy the text message.'
                        );
                      });
                  }}
                >
                  <MessageSquare className="mr-2 h-4 w-4" aria-hidden />
                  {copied === 'sms' ? 'Copied' : 'Copy text for SMS'}
                </Button>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            data-testid="new-client-cancel"
            onClick={() => {
              if (step === 'details' || sentLink) {
                onOpenChange(false);
              } else if (step === 'compose') {
                setStep('details');
              } else {
                setStep('compose');
              }
            }}
          >
            {step === 'details' || sentLink
              ? t('matter.new-client.cancel')
              : 'Back'}
          </Button>
          {step === 'details' ? (
            <Button
              data-testid="new-client-next"
              className="gap-2"
              onClick={() => {
                setStep('compose');
              }}
              disabled={!name.trim()}
            >
              <Plus className="h-4 w-4" />
              Next
            </Button>
          ) : step === 'compose' ? (
            <Button
              data-testid="new-client-review"
              className="gap-2"
              onClick={() => {
                setStep('review');
              }}
              disabled={!canReview}
            >
              Review
            </Button>
          ) : sentLink ? (
            <Button
              data-testid="new-client-done"
              className="gap-2"
              onClick={() => {
                if (createdMatterId) setClientMapHubTab('onboarding');
                onOpenChange(false);
              }}
            >
              Done
            </Button>
          ) : (
            <Button
              data-testid="new-client-create"
              className="gap-2"
              onClick={handleCreate}
              disabled={isCreating || !canReview}
            >
              {canCreateOnboardingLink ? (
                <Send className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {canCreateOnboardingLink ? 'Create link' : 'Create client'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NewClientDialog;
