import type { FormRequest, RequestItem } from '@/platform/intake/types';
import type { WelcomeJourney } from '@/platform/intake/welcomeJourneyDefaults';
import { sanitizeWelcomeJourney } from '@/platform/intake/welcomeJourneyDefaults';
import { createInitialIntakeLinkBundle, type InitialIntakeLinkBundle } from './intakeLifecycle';
import {
  clearIntakeSecrets,
  clearPdfTemplateDescriptor,
  storeIntakeSecrets,
  storePdfTemplateDescriptor,
} from './intakeKeychain';
import type { IntakeRelayClient } from './IntakeRelayClient';
import { useIntakeStore } from './intakeStore';
import { assertRequestSlug, createOpaqueItemHandle, createRequestSlug } from './requestIdentity';
import { assertValidPdfTemplateDescriptor } from './pdfTemplates/templateValidation';

export interface IntakeFirm {
  name: string;
  accent: string;
  advisor_name: string;
  advisor_email: string;
  next_steps: string[];
  /** Firm-authored client wording. It is sealed as part of the checklist. */
  journey: WelcomeJourney;
}

export interface AdvisorIntakeChecklist extends FormRequest {
  client_first_name: string;
  confirmations: Record<string, string>;
  firm: IntakeFirm;
}

export interface CreateAdvisorIntakeOptions {
  intakeId: string;
  matterId: string;
  intakeHost: string;
  expiresAt: string;
  checklist: FormRequest;
  clientFirstName: string;
  firm: IntakeFirm;
  relay: Pick<IntakeRelayClient, 'createIntake'> & Partial<Pick<IntakeRelayClient, 'revokeIntake'>>;
  /** Optional title for standing requests; onboarding retains its established title and wire shape. */
  requestTitle?: string;
  /** A locally generated stable folder name. If absent, standing requests receive one. */
  requestSlug?: string;
  /** Firm callers publish a separate E2EE device grant after the mailbox exists. */
  publishTeamKey?: (intakeId: string, matterId: string) => Promise<void>;
}

export function assertSendableRequest(items: RequestItem[]): void {
  const signature = items.find((item) => item.t === 'signature');
  if (signature) throw new Error('signature items cannot be sent through an intake link.');
  for (const item of items) {
    if (item.t !== 'pdf_fill') continue;
    try {
      assertValidPdfTemplateDescriptor(item.template);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown template validation error.';
      throw new Error(`pdf_fill items cannot be sent through an intake link until their template is approved: ${message}`);
    }
  }
}

function requestItemsForIssue(checklist: FormRequest): RequestItem[] {
  if (checklist.kind !== 'standing') return checklist.items;
  return checklist.items.map((item) => ({ ...item, item_id: createOpaqueItemHandle() }));
}

function redactPdfTemplateDescriptorsForStore(requestItems: RequestItem[]): RequestItem[] {
  return requestItems.map((item) => {
    if (item.t !== 'pdf_fill') return item;
    return {
      ...item,
      // The complete reviewed map lives in the intake keychain, not Zustand persistence.
      template: {
        templateId: item.template.templateId,
        version: item.template.version,
        kind: item.template.kind,
      } as typeof item.template,
    };
  });
}

export async function createAdvisorIntake(
  options: CreateAdvisorIntakeOptions,
): Promise<InitialIntakeLinkBundle> {
  assertSendableRequest(options.checklist.items);
  const requestItems = requestItemsForIssue(options.checklist);
  const requestSlug = options.checklist.kind === 'onboarding'
    ? 'onboarding'
    : options.requestSlug === undefined
      ? createRequestSlug()
      : assertRequestSlug(options.requestSlug);
  const requestTitle = options.requestTitle ?? (options.checklist.kind === 'onboarding'
    ? 'New client onboarding'
    : 'Client request');
  // Seal the complete page contract here. The relay never sees this plaintext.
  const checklist: AdvisorIntakeChecklist = {
    ...options.checklist,
    items: requestItems,
    client_first_name: options.clientFirstName,
    confirmations: {},
    firm: { ...options.firm, journey: sanitizeWelcomeJourney(options.firm.journey) },
  };
  const firstItem = checklist.items[0]?.item_id;
  const initialState = {
    ...(firstItem ? { current_item_id: firstItem } : {}),
    completed_item_ids: [],
    confirmations: {},
  };
  const bundle = await createInitialIntakeLinkBundle({
    intakeId: options.intakeId,
    intakeHost: options.intakeHost,
    checklist,
    initialState,
  });
  const store = useIntakeStore.getState();
  const storedRequestItems = redactPdfTemplateDescriptorsForStore(requestItems);
  // This visible local draft exists before the network call, so there is never an
  // untracked live link if the network step fails or the app closes mid-send.
  try {
    await Promise.all(requestItems.flatMap((item) => item.t === 'pdf_fill'
      ? [storePdfTemplateDescriptor(options.intakeId, item.item_id, item.template)]
      : []));
    store.upsertIntake({
      intakeId: options.intakeId,
      matterId: options.matterId,
      kind: checklist.kind,
      ...(checklist.blueprint_ref ? { blueprintRef: checklist.blueprint_ref } : {}),
      requestTitle,
      requestSlug,
      clientFirstName: options.clientFirstName,
      firmName: options.firm.name,
      status: 'draft',
      createdAt: new Date().toISOString(),
      expiresAt: options.expiresAt,
      checklistVersion: 1,
      requestItems: storedRequestItems,
      items: requestItems.map((item) => ({ itemId: item.item_id, label: item.label, state: 'not_started' })),
      receivedItems: [], flags: [], knownSessionIds: [], knownSubmissionIds: [], nudges: [],
    });
    await storeIntakeSecrets(options.intakeId, bundle.privateKey, bundle.linkSecretB64);
    await options.relay.createIntake({
      intake_id: options.intakeId,
      auth_token: bundle.tokenB64,
      expires_at: options.expiresAt,
      checklist_ciphertext_b64: bundle.checklistCiphertextB64,
      state_ciphertext_b64: bundle.stateCiphertextB64,
      checklist_version: 1,
    });
  } catch (error) {
    try {
      await options.relay.revokeIntake?.(options.intakeId);
    } catch { // eslint-disable-line lantern-async/no-silent-failure -- best-effort revoke during already-failed-creation cleanup; the original error is rethrown below regardless.
    }
    await clearIntakeSecrets(options.intakeId);
    await Promise.all(requestItems.flatMap((item) => item.t === 'pdf_fill'
      ? [clearPdfTemplateDescriptor(options.intakeId, item.item_id)]
      : []));
    useIntakeStore.getState().removeIntake(options.intakeId);
    throw error;
  }
  useIntakeStore.getState().updateIntake(options.intakeId, {
    status: 'active',
    link: bundle.link,
    publicKeyRawB64: bytesToB64(bundle.publicKeyRaw),
    checklistCiphertextB64: bundle.checklistCiphertextB64,
    stateCiphertextB64: bundle.stateCiphertextB64,
  });
  if (options.publishTeamKey) await options.publishTeamKey(options.intakeId, options.matterId);
  return bundle;
}

function bytesToB64(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += String.fromCharCode(byte);
  return btoa(result);
}
