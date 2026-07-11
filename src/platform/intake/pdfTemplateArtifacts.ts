import { invoke, isTauri } from '@tauri-apps/api/core';

const browserArtifacts = new Map<string, string>();

/**
 * Large approved-template data lives in the workspace's encrypted artifact
 * shelf. The OS keychain holds encryption keys, never a PDF or field map.
 */
export async function writePdfTemplateArtifact(templateId: string, value: string): Promise<void> {
  if (!isTauri()) {
    browserArtifacts.set(templateId, value);
    return;
  }
  await invoke('intake_pdf_template_artifact_write', { templateId, value });
}

export async function readPdfTemplateArtifact(templateId: string): Promise<string | null> {
  if (!isTauri()) {
    return browserArtifacts.get(templateId) ?? null;
  }
  try {
    return await invoke<string | null>('intake_pdf_template_artifact_read', { templateId });
  } catch {
    return null;
  }
}

export async function deletePdfTemplateArtifact(templateId: string): Promise<void> {
  if (!isTauri()) {
    browserArtifacts.delete(templateId);
    return;
  }
  await invoke('intake_pdf_template_artifact_delete', { templateId });
}
