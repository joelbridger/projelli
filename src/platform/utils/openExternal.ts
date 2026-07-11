// Cross-platform external link opener
// Supports both browser (window.open) and Tauri (shell plugin)

import { isTauriEnvironment } from '@/platform/fs/BackendFactory';
import { assertEgressNavigationAllowed } from '@/platform/privacy/networkClient';

/**
 * Opens a URL in the system's default browser (Tauri) or a new tab (browser)
 * @param url - The URL to open
 * @returns Promise that resolves when the operation completes
 */
export async function openExternal(url: string): Promise<void> {
  const isTauri = isTauriEnvironment();

  // This is a real off-device action in the desktop app, even though the
  // operating system owns the browser after the hand-off.
  await assertEgressNavigationAllowed('external-navigation', url);

  if (isTauri) {
    // Tauri mode: Use shell plugin to open in system browser
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
    } catch (error) {
      console.error('[openExternal] Failed to open URL in Tauri:', error);
      throw new Error(`Failed to open URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } else {
    // Browser mode: Use window.open
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      throw new Error('Failed to open URL. Popup may have been blocked.');
    }
  }
}
