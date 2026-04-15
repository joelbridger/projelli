/**
 * Global drag-and-drop upload (UX-19).
 *
 * Users expect to drag files into a workspace app (Notion, Obsidian, VS Code
 * all support it). This hook + overlay pair lets Projelli handle drops onto
 * the window itself — not just the upload button.
 *
 * Contract:
 *   - The hook attaches dragenter/dragleave/dragover/drop handlers to window
 *     and counts drag events so the overlay only shows while at least one
 *     file is dragged over the window. We count instead of relying on a
 *     single enter/leave boolean because child elements fire their own
 *     enter/leave, turning the overlay into a flicker machine otherwise.
 *   - When a drop lands on a specific folder in the tree (see
 *     `FileTree.tsx` — it tags folder rows with `data-folder-path`), we
 *     route the files into that folder. Otherwise they land in the
 *     workspace root.
 *   - Non-file drops are ignored (e.g. dragging a Projelli tab around).
 *
 * Duplicate handling, `.DS_Store` filtering, and post-drop tab opening are
 * implemented in `dropFilesIntoWorkspace` (see `fileDrop.ts`).
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** Files the OS or browsers drop on us that nobody actually wants imported. */
const NOISE_FILENAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export function filterNoiseFiles(files: File[]): File[] {
  return files.filter((f) => !NOISE_FILENAMES.has(f.name));
}

/**
 * Look up the nearest ancestor element tagged with `data-folder-path`.
 * FileTree rows set this on folder elements so a drop on a folder can be
 * routed into that folder rather than workspace root.
 */
export function findFolderTarget(target: EventTarget | null): string | null {
  if (!target || !(target instanceof HTMLElement)) return null;
  const el = target.closest('[data-folder-path]') as HTMLElement | null;
  return el ? el.getAttribute('data-folder-path') : null;
}

export interface DropHookOptions {
  /**
   * Called with the filtered File[] and the resolved target folder path
   * (or null → workspace root).
   */
  onDrop: (files: File[], folderPath: string | null) => void | Promise<void>;
  /** If false, the listeners are not attached. Useful when no workspace. */
  enabled?: boolean;
}

export function useGlobalFileDrop({ onDrop, enabled = true }: DropHookOptions) {
  const [isDragging, setIsDragging] = useState(false);
  // Counter: only reaches 0 when every enter has a matching leave.
  const depthRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setIsDragging(false);
      depthRef.current = 0;
      return;
    }

    const hasFiles = (e: DragEvent): boolean => {
      const dt = e.dataTransfer;
      if (!dt) return false;
      // `types` includes 'Files' when the user is actually dragging files
      // from the OS. Internal HTML5 drag (tab reorder) uses 'text/plain'
      // and no 'Files' entry.
      if (dt.types && Array.from(dt.types).includes('Files')) return true;
      return false;
    };

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depthRef.current += 1;
      setIsDragging(true);
    };

    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Ignore leaves that don't actually exit the window — the counter
      // handles the real state.
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setIsDragging(false);
    };

    const onDragOver = (e: DragEvent) => {
      // Always prevent default on file drags so the browser doesn't navigate
      // to the dropped file when the overlay happens to be hidden.
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    const onDropEvt = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depthRef.current = 0;
      setIsDragging(false);
      const fileList = e.dataTransfer?.files;
      if (!fileList || fileList.length === 0) return;
      const files = filterNoiseFiles(Array.from(fileList));
      if (files.length === 0) return;
      const folderPath = findFolderTarget(e.target);
      await onDrop(files, folderPath);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDropEvt);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDropEvt);
    };
  }, [onDrop, enabled]);

  return { isDragging };
}

export interface GlobalDropOverlayProps {
  visible: boolean;
  message?: string;
  className?: string;
}

export function GlobalDropOverlay({
  visible,
  message = 'Drop files to add to your workspace',
  className,
}: GlobalDropOverlayProps) {
  if (!visible) return null;
  return (
    <div
      data-testid="file-drop-overlay"
      // Let pointer events pass through to the underlying tree so the
      // folder-target detection fires against whatever element is under
      // the cursor.
      className={cn(
        'fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none',
        'bg-background/60 backdrop-blur-sm',
        className
      )}
      aria-hidden="true"
    >
      <div className="border-2 border-dashed border-primary rounded-lg bg-background/80 px-8 py-6 text-center shadow-lg">
        <p className="text-lg font-semibold text-foreground">{message}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop on a folder to put them there, or drop anywhere else to add to
          the workspace root.
        </p>
      </div>
    </div>
  );
}

export default GlobalDropOverlay;
