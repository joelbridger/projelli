import { deriveAuthToken, derivePageKey, generateIntakeKeypair } from '@/platform/intake/intakeCrypto';
import { buildLinkFragment } from '@/platform/intake/intakeLink';
import { b64ToBytes, bytesToB64, openPageJson, sealPageJson } from './pageSeal';
import type { FormRequest } from './types';

export interface IntakeResumeState {
  current_item_id?: string;
  completed_item_ids: string[];
  confirmations: Record<string, string>;
}

export interface InitialIntakeLinkOptions {
  intakeId: string;
  intakeHost: string;
  checklist: FormRequest;
  initialState: IntakeResumeState;
}

export interface InitialIntakeLinkBundle {
  intakeId: string;
  link: string;
  tokenB64: string;
  linkSecretB64: string;
  publicKeyRaw: Uint8Array;
  privateKey: CryptoKey;
  checklistCiphertextB64: string;
  stateCiphertextB64: string;
}

export interface RegenerateIntakeLinkOptions {
  intakeId: string;
  intakeHost: string;
  publicKeyRaw: Uint8Array;
  checklistCiphertextB64: string;
  stateCiphertextB64: string;
  oldLinkSecret: Uint8Array;
}

export interface RegeneratedIntakeLink {
  link: string;
  tokenB64: string;
  linkSecretB64: string;
  checklistCiphertextB64: string;
  stateCiphertextB64: string;
}

function cleanHost(intakeHost: string): string {
  return intakeHost.replace(/\/+$/u, '');
}

export function generateLinkSecretB64(): string {
  return bytesToB64(crypto.getRandomValues(new Uint8Array(32)));
}

export function buildIntakeUrl(intakeHost: string, intakeId: string, fragment: string): string {
  return `${cleanHost(intakeHost)}/i/${encodeURIComponent(intakeId)}#${fragment}`;
}

export async function createInitialIntakeLinkBundle(
  options: InitialIntakeLinkOptions,
): Promise<InitialIntakeLinkBundle> {
  const { privateKey, publicKeyRaw } = await generateIntakeKeypair();
  const linkSecretB64 = generateLinkSecretB64();
  const s = b64ToBytes(linkSecretB64);
  const pageKey = await derivePageKey(s);
  const checklistCiphertextB64 = await sealPageJson(pageKey, options.checklist);
  const stateCiphertextB64 = await sealPageJson(pageKey, options.initialState);
  const token = await deriveAuthToken(s);
  const fragment = buildLinkFragment(linkSecretB64, publicKeyRaw);
  return {
    intakeId: options.intakeId,
    link: buildIntakeUrl(options.intakeHost, options.intakeId, fragment),
    tokenB64: token.tokenB64,
    linkSecretB64,
    publicKeyRaw,
    privateKey,
    checklistCiphertextB64,
    stateCiphertextB64,
  };
}

export async function regenerateIntakeLink(
  options: RegenerateIntakeLinkOptions,
): Promise<RegeneratedIntakeLink> {
  const oldPageKey = await derivePageKey(options.oldLinkSecret);
  const checklist = await openPageJson<FormRequest>(oldPageKey, options.checklistCiphertextB64);
  const state = await openPageJson<IntakeResumeState>(oldPageKey, options.stateCiphertextB64);

  const linkSecretB64 = generateLinkSecretB64();
  const nextSecret = b64ToBytes(linkSecretB64);
  const nextPageKey = await derivePageKey(nextSecret);
  const checklistCiphertextB64 = await sealPageJson(nextPageKey, checklist);
  const stateCiphertextB64 = await sealPageJson(nextPageKey, state);
  const token = await deriveAuthToken(nextSecret);
  const fragment = buildLinkFragment(linkSecretB64, options.publicKeyRaw);

  return {
    link: buildIntakeUrl(options.intakeHost, options.intakeId, fragment),
    tokenB64: token.tokenB64,
    linkSecretB64,
    checklistCiphertextB64,
    stateCiphertextB64,
  };
}
