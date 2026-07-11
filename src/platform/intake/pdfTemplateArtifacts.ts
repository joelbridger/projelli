import { invoke, isTauri } from '@tauri-apps/api/core';

import { KC_FALLBACK_PREFIX } from '@/config/identity';

const PDF_TEMPLATE_ARTIFACT_SERVICE = 'intake.pdf-template-artifact';

function fallbackKey(templateId: string): string {
  return `${KC_FALLBACK_PREFIX}${PDF_TEMPLATE_ARTIFACT_SERVICE}::${templateId}`;
}

function utf8ToB64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function b64ToUtf8(value: string): string {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let index = 0; index < bin.length; index += 1) bytes[index] = bin.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

/**
 * Large approved-template data lives in the workspace's encrypted artifact
 * shelf. The OS keychain holds encryption keys, never a PDF or field map.
 */
export async function writePdfTemplateArtifact(templateId: string, value: string): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(fallbackKey(templateId), utf8ToB64(value));
    return;
  }
  await invoke('intake_pdf_template_artifact_write', { templateId, value });
}

export async function readPdfTemplateArtifact(templateId: string): Promise<string | null> {
  if (!isTauri()) {
    const raw = localStorage.getItem(fallbackKey(templateId));
    if (raw === null) return null;
    try {
      return b64ToUtf8(raw);
    } catch {
      return null;
    }
  }
  try {
    return await invoke<string | null>('intake_pdf_template_artifact_read', { templateId });
  } catch {
    return null;
  }
}

export async function deletePdfTemplateArtifact(templateId: string): Promise<void> {
  if (!isTauri()) {
    localStorage.removeItem(fallbackKey(templateId));
    return;
  }
  await invoke('intake_pdf_template_artifact_delete', { templateId });
}
