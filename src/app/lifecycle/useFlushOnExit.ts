/**
 * useFlushOnExit (BUG-046) — best-effort flush of dirty tabs to disk when the
 * app/window is closing or reloading, so the last edits aren't lost in the 2s
 * autosave window.
 *
 * `pagehide` fires on tab/window close and navigation (and on the Tauri webview
 * teardown); `beforeunload` covers reload. Neither can reliably AWAIT an async
 * write, but the writes are kicked off synchronously and small text saves
 * usually complete; combined with the workspace-switch flush and autosave, this
 * closes the common "typed then immediately closed" loss. A fully-awaitable
 * desktop close (Tauri `onCloseRequested`) is tracked as a follow-up.
 */
import { useEffect } from 'react';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { flushAllDirtyTabs } from '@/app/fileOps/flushDirtyTabs';

export function useFlushOnExit(serviceRef: { readonly current: WorkspaceService | null }): void {
  useEffect(() => {
    const handler = () => {
      const service = serviceRef.current;
      if (service) void flushAllDirtyTabs(service);
    };
    window.addEventListener('pagehide', handler);
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('pagehide', handler);
      window.removeEventListener('beforeunload', handler);
    };
  }, [serviceRef]);
}
