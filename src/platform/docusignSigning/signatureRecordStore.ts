import { isTauri } from '@tauri-apps/api/core';

import { KC_FALLBACK_PREFIX, KC_FIRM_NS } from '@/config/identity';
import { keychainDelete, keychainGet, keychainSet } from '@/platform/utils/tauri-commands';
import { assertValidLocalSignatureRecord, type LocalSignatureRecord } from '@/platform/intake/docusignSignature/signatureRecord';
import type { DocusignEgressReceipt } from './egressReceipt';

const KEY_PREFIX = 'docusign_signature_record:';

export interface StoredLocalSignatureRecord {
  record: LocalSignatureRecord;
  egressReceipts: DocusignEgressReceipt[];
}

function service(intakeId: string): string { return `${KC_FIRM_NS}.intake.${intakeId}`; }
function key(requestId: string, signatureItemId: string): string { return `${KEY_PREFIX}${requestId}:${signatureItemId}`; }
function fallbackKey(intakeId: string, recordKey: string): string { return `${KC_FALLBACK_PREFIX}${service(intakeId)}::${recordKey}`; }
function encode(value: string): string { return btoa(String.fromCharCode(...new TextEncoder().encode(value))); }
function decode(value: string): string { return new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0))); }

function assertStored(value: unknown): asserts value is StoredLocalSignatureRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid local signature record.');
  const parsed = value as Partial<StoredLocalSignatureRecord>;
  assertValidLocalSignatureRecord(parsed.record);
  if (!Array.isArray(parsed.egressReceipts)) throw new Error('Invalid signature egress receipts.');
}

/** OS-keychain persistence. Browser development uses the existing obfuscated fallback only. */
export async function saveLocalSignatureRecord(intakeId: string, value: StoredLocalSignatureRecord): Promise<void> {
  assertStored(value);
  const serialized = JSON.stringify(value);
  if (isTauri()) { await keychainSet(key(value.record.requestId, value.record.signatureItemId), serialized, service(intakeId)); return; }
  if (typeof localStorage === 'undefined') throw new Error('No secure local record storage is available.');
  localStorage.setItem(fallbackKey(intakeId, key(value.record.requestId, value.record.signatureItemId)), encode(serialized));
}

export async function loadLocalSignatureRecord(intakeId: string, requestId: string, signatureItemId: string): Promise<StoredLocalSignatureRecord | null> {
  let raw: string | null = null;
  if (isTauri()) { try { raw = await keychainGet(key(requestId, signatureItemId), service(intakeId)); } catch { return null; } }
  else if (typeof localStorage !== 'undefined') { const value = localStorage.getItem(fallbackKey(intakeId, key(requestId, signatureItemId))); raw = value ? decode(value) : null; }
  if (!raw) return null;
  try { const parsed: unknown = JSON.parse(raw); assertStored(parsed); return parsed; } catch { return null; }
}

export async function deleteLocalSignatureRecord(intakeId: string, requestId: string, signatureItemId: string): Promise<void> {
  if (isTauri()) { await keychainDelete(key(requestId, signatureItemId), service(intakeId)); return; }
  if (typeof localStorage !== 'undefined') localStorage.removeItem(fallbackKey(intakeId, key(requestId, signatureItemId)));
}
