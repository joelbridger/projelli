import type { FormRequest, RequestItem } from '@/platform/intake/types';
import type { WelcomeJourney } from '@/features/intake/welcomeJourneyDefaults';
import { sanitizeWelcomeJourney } from '@/features/intake/welcomeJourneyDefaults';
import { createInitialIntakeLinkBundle, type InitialIntakeLinkBundle } from './intakeLifecycle';
import { clearIntakeSecrets, storeIntakeSecrets } from './intakeKeychain';
import type { IntakeRelayClient } from './IntakeRelayClient';
import { useIntakeStore } from './intakeStore';
import { assertRequestSlug, createOpaqueItemHandle, createRequestSlug } from './requestIdentity';

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
  const unsupported = items.find((item) => item.t === 'pdf_fill' || item.t === 'signature');
  if (unsupported) throw new Error(`${unsupported.t} items cannot be sent through an intake link.`);
}

function requestItemsForIssue(checklist: FormRequest): RequestItem[] {
  if (checklist.kind !== 'standing') return checklist.items;
  return checklist.items.map((item) => ({ ...item, item_id: createOpaqueItemHandle() }));
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
  // This visible local draft exists before the network call, so there is never an
  // untracked live link if the network step fails or the app closes mid-send.
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
    requestItems,
    items: requestItems.map((item) => ({ itemId: item.item_id, label: item.label, state: 'not_started' })),
    receivedItems: [], flags: [], knownSessionIds: [], knownSubmissionIds: [], nudges: [],
  });
  try {
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
    try { await options.relay.revokeIntake?.(options.intakeId); } catch { /* best-effort cleanup */ }
    await clearIntakeSecrets(options.intakeId);
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
