import { invoke, isTauri } from '@tauri-apps/api/core';

/**
 * Large approved-template data lives in the workspace's encrypted artifact
 * shelf. The OS keychain holds encryption keys, never a PDF or field map.
 */
export async function writePdfTemplateArtifact(templateId: string, value: string): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(`lantern:intake-pdf-template-artifact:${templateId}`, value);
    return;
  }
  await invoke('intake_pdf_template_artifact_write', { templateId, value });
}

export async function readPdfTemplateArtifact(templateId: string): Promise<string | null> {
  if (!isTauri()) return localStorage.getItem(`lantern:intake-pdf-template-artifact:${templateId}`);
  try {
    return await invoke<string | null>('intake_pdf_template_artifact_read', { templateId });
  } catch {
    return null;
  }
}

export async function deletePdfTemplateArtifact(templateId: string): Promise<void> {
  if (!isTauri()) {
    localStorage.removeItem(`lantern:intake-pdf-template-artifact:${templateId}`);
    return;
  }
  await invoke('intake_pdf_template_artifact_delete', { templateId });
}
