import { isTauri } from '@tauri-apps/api/core';

import { KC_FALLBACK_PREFIX, KC_FIRM_NS } from '@/config/identity';
import { keychainDelete, keychainGet, keychainSet } from '@/platform/utils/tauri-commands';
import type { PdfTemplateDescriptor } from './pdfTemplates/templateContract';
import { assertValidPdfTemplateDescriptor } from './pdfTemplates/templateValidation';

const KC_PRIVATE_JWK = 'private_jwk';
const KC_LINK_SECRET = 'link_secret_b64';
const KC_PDF_TEMPLATE_DESCRIPTOR = 'pdf_template_descriptor';

export function intakeService(intakeId: string): string {
  return `${KC_FIRM_NS}.intake.${intakeId}`;
}

function fallbackKey(service: string, key: string): string {
  return `${KC_FALLBACK_PREFIX}${service}::${key}`;
}

function pdfTemplateDescriptorKey(itemId: string): string {
  return `${KC_PDF_TEMPLATE_DESCRIPTOR}:${itemId}`;
}

function utf8ToB64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function setSecret(service: string, key: string, value: string): Promise<void> {
  if (isTauri()) {
    await keychainSet(key, value, service);
    return;
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(fallbackKey(service, key), utf8ToB64(value));
    return;
  }
  throw new Error('No secret storage available.');
}

async function getSecret(service: string, key: string): Promise<string | null> {
  if (isTauri()) {
    try {
      return await keychainGet(key, service);
    } catch {
      return null;
    }
  }
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(fallbackKey(service, key));
    if (raw == null) return null;
    try {
      return b64ToUtf8(raw);
    } catch {
      return null;
    }
  }
  return null;
}

async function deleteSecret(service: string, key: string): Promise<void> {
  if (isTauri()) {
    await keychainDelete(key, service);
    return;
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(fallbackKey(service, key));
  }
}

export async function storeIntakeSecrets(
  intakeId: string,
  privateKey: CryptoKey,
  linkSecretB64: string,
): Promise<void> {
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  await storeIntakePrivateKeyJwk(intakeId, jwk);
  const service = intakeService(intakeId);
  await setSecret(service, KC_LINK_SECRET, linkSecretB64);
}

/** Validate the only private-key shape this keychain may persist. */
export function validateIntakePrivateKeyJwk(value: unknown): JsonWebKey {
  if (!value || typeof value !== 'object') throw new Error('Invalid intake private key.');
  const jwk = value as JsonWebKey;
  if (
    jwk.kty !== 'EC' || jwk.crv !== 'P-256' ||
    typeof jwk.d !== 'string' || jwk.d.length === 0 ||
    typeof jwk.x !== 'string' || jwk.x.length === 0 ||
    typeof jwk.y !== 'string' || jwk.y.length === 0
  ) {
    throw new Error('Intake private key must be an EC P-256 JWK with private material.');
  }
  return { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y, ext: false, key_ops: ['deriveBits'] };
}

/** Load the validated private JWK for E2EE team distribution. */
export async function loadIntakePrivateKeyJwk(intakeId: string): Promise<JsonWebKey | null> {
  const raw = await getSecret(intakeService(intakeId), KC_PRIVATE_JWK);
  if (!raw) return null;
  try {
    return validateIntakePrivateKeyJwk(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Store a validated private JWK received through an E2EE device wrap. */
export async function storeIntakePrivateKeyJwk(intakeId: string, jwk: JsonWebKey): Promise<void> {
  const valid = validateIntakePrivateKeyJwk(jwk);
  await setSecret(intakeService(intakeId), KC_PRIVATE_JWK, JSON.stringify(valid));
}

export async function loadIntakePrivateKey(intakeId: string): Promise<CryptoKey | null> {
  const jwk = await loadIntakePrivateKeyJwk(intakeId);
  if (!jwk) return null;
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
}

export async function loadIntakeLinkSecret(intakeId: string): Promise<string | null> {
  return getSecret(intakeService(intakeId), KC_LINK_SECRET);
}

export async function updateIntakeLinkSecret(intakeId: string, linkSecretB64: string): Promise<void> {
  await setSecret(intakeService(intakeId), KC_LINK_SECRET, linkSecretB64);
}

/** Store one complete PDF template descriptor outside persisted intake state. */
export async function storePdfTemplateDescriptor(
  intakeId: string,
  itemId: string,
  descriptor: PdfTemplateDescriptor,
): Promise<void> {
  assertValidPdfTemplateDescriptor(descriptor);
  await setSecret(intakeService(intakeId), pdfTemplateDescriptorKey(itemId), JSON.stringify(descriptor));
}

/** Load the complete descriptor needed to verify a returned PDF after restart. */
export async function loadPdfTemplateDescriptor(
  intakeId: string,
  itemId: string,
): Promise<PdfTemplateDescriptor | null> {
  const raw = await getSecret(intakeService(intakeId), pdfTemplateDescriptorKey(itemId));
  if (!raw) return null;
  try {
    const descriptor: unknown = JSON.parse(raw);
    assertValidPdfTemplateDescriptor(descriptor);
    return descriptor;
  } catch {
    return null;
  }
}

/** Remove the one complete PDF template descriptor stored for an intake item. */
export async function clearPdfTemplateDescriptor(intakeId: string, itemId: string): Promise<void> {
  await deleteSecret(intakeService(intakeId), pdfTemplateDescriptorKey(itemId));
}

export async function clearIntakeSecrets(intakeId: string): Promise<void> {
  const service = intakeService(intakeId);
  await deleteSecret(service, KC_PRIVATE_JWK);
  await deleteSecret(service, KC_LINK_SECRET);
}
