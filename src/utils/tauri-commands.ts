// Thin wrappers around custom Tauri commands defined in
// `src-tauri/src/commands/fs.rs`. Each wrapper is safe to call from browser
// test mode: `isTauri()` returns false and the function short-circuits with a
// browser-appropriate fallback (null for detection, thrown error for
// conversion).
//
// The app already has a detection helper `isTauriEnvironment()` in
// BackendFactory, but that reads `window.__TAURI__` directly. Here we use
// the official `isTauri` export from `@tauri-apps/api/core` so mocks that
// replace `window.__TAURI_INTERNALS__` (Tauri v2's real internal bridge) flow
// through the same code path the rest of the Tauri API uses.

import { invoke, isTauri } from '@tauri-apps/api/core';

/**
 * Detect whether LibreOffice (`soffice`) is installed on the user's system.
 *
 * @returns the absolute path to the soffice binary, or `null` if not found
 *   (or if running in the browser).
 */
export async function detectLibreOffice(): Promise<string | null> {
  if (!isTauri()) return null;
  const result = await invoke<string | null>('detect_libreoffice');
  return result;
}

/**
 * Convert a legacy `.doc` file to `.docx` using LibreOffice in headless mode.
 * The output `.docx` is written next to the input file.
 *
 * @param inputPath absolute path to the `.doc` file
 * @returns absolute path of the produced `.docx` file
 * @throws if LibreOffice isn't installed, the conversion fails, or we're in
 *   the browser (conversion is only available in the desktop app)
 */
export async function convertDocToDocx(inputPath: string): Promise<string> {
  if (!isTauri()) {
    throw new Error('Conversion is only available in the desktop app.');
  }
  return invoke<string>('convert_doc_to_docx', { inputPath });
}
