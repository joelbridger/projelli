import type { FormRequest } from '@/platform/intake/types';
import { createInitialIntakeLinkBundle, type InitialIntakeLinkBundle } from './intakeLifecycle';
import { storeIntakeSecrets } from './intakeKeychain';
import type { IntakeRelayClient } from './IntakeRelayClient';

export interface CreateAdvisorIntakeOptions {
  intakeId: string;
  matterId: string;
  intakeHost: string;
  expiresAt: string;
  checklist: FormRequest;
  relay: Pick<IntakeRelayClient, 'createIntake'>;
}

export async function createAdvisorIntake(
  options: CreateAdvisorIntakeOptions,
): Promise<InitialIntakeLinkBundle> {
  const firstItem = options.checklist.items[0]?.item_id;
  const initialState = {
    ...(firstItem ? { current_item_id: firstItem } : {}),
    completed_item_ids: [],
    confirmations: {},
  };
  const bundle = await createInitialIntakeLinkBundle({
    intakeId: options.intakeId,
    intakeHost: options.intakeHost,
    checklist: options.checklist,
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
  return bundle;
}
