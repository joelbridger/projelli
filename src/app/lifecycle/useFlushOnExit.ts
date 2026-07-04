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
import { hasAnyUnsavedDocx } from '@/platform/fs/docxSaveRegistry';

export function useFlushOnExit(serviceRef: { readonly current: WorkspaceService | null }): void {
  useEffect(() => {
    const handler = () => {
      const service = serviceRef.current;
      if (service) void flushAllDirtyTabs(service);
    };
    // QA-34: the async flush above can't be awaited before the page tears down,
    // and a .docx write can fail under a lock. If ANY open .docx still has work
    // not confirmed on disk (dirty, mid-save, or failed), fire the browser's
    // native "you have unsaved changes — leave?" prompt SYNCHRONOUSLY so the user
    // isn't silently torn down and can go back to let it save or rescue the doc
    // ("Save a copy elsewhere"). Autosave keeps docs clean within ~1.2s of the
    // last edit, so this only fires in the genuinely-at-risk window, not on every
    // quit. preventDefault() is the spec'd trigger in the Chromium-based WebView2
    // this ships in (the legacy `returnValue = ''` is deprecated and unneeded).
    const beforeUnload = (e: BeforeUnloadEvent) => {
      handler();
      if (hasAnyUnsavedDocx()) {
        e.preventDefault();
      }
    };
    window.addEventListener('pagehide', handler);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('pagehide', handler);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [serviceRef]);
}
