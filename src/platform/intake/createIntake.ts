import type { FormRequest } from '@/platform/intake/types';
import type { WelcomeJourney } from '@/features/intake/welcomeJourneyDefaults';
import { sanitizeWelcomeJourney } from '@/features/intake/welcomeJourneyDefaults';
import { createInitialIntakeLinkBundle, type InitialIntakeLinkBundle } from './intakeLifecycle';
import { storeIntakeSecrets } from './intakeKeychain';
import type { IntakeRelayClient } from './IntakeRelayClient';

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
  relay: Pick<IntakeRelayClient, 'createIntake'>;
  /** Firm callers publish a separate E2EE device grant after the mailbox exists. */
  publishTeamKey?: (intakeId: string, matterId: string) => Promise<void>;
}

export async function createAdvisorIntake(
  options: CreateAdvisorIntakeOptions,
): Promise<InitialIntakeLinkBundle> {
  // Seal the complete page contract here. The relay never sees this plaintext.
  const checklist: AdvisorIntakeChecklist = {
    ...options.checklist,
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
  await storeIntakeSecrets(options.intakeId, bundle.privateKey, bundle.linkSecretB64);
  await options.relay.createIntake({
    intake_id: options.intakeId,
    matter_id: options.matterId,
    auth_token: bundle.tokenB64,
    expires_at: options.expiresAt,
    checklist_ciphertext_b64: bundle.checklistCiphertextB64,
    state_ciphertext_b64: bundle.stateCiphertextB64,
    checklist_version: 1,
  });
  if (options.publishTeamKey) await options.publishTeamKey(options.intakeId, options.matterId);
  return bundle;
}
