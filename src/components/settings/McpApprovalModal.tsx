/**
 * MCP write-approval modal (M4, v1.5 Flag 2).
 *
 * Renders when the `projelli-mcp` sidecar has queued one or more pending
 * write requests (the sidecar drops a JSON blob in a temp dir when an MCP
 * client calls `write_workspace_file` with `require_confirmation = true`).
 *
 * The modal shows:
 *   - the workspace-relative path about to be written
 *   - a minimal diff preview (old content vs new), or full preview for a
 *     new file
 *   - three actions: Approve this write, Approve all for the session,
 *     Deny
 *
 * "Approve all for the session" is a per-React-tree flag stored in React
 * state (NOT persisted). Restarting Projelli clears it — a deliberate
 * safety default.
 *
 * This component does NOT own the polling loop; callers pass in the
 * current pending-approvals array plus `onRespond(token, approved)`. The
 * polling loop lives in `App.tsx` so it can coordinate with the rest of
 * the Tauri event listeners.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Check, X, FilePlus2, FilePen } from 'lucide-react';
import type { McpPendingApproval } from '@/utils/tauri-commands';

export interface McpApprovalModalProps {
  /** Current pending approvals queue. When empty, the modal stays closed. */
  approvals: McpPendingApproval[];
  /** Called when the user picks Approve / Deny on the topmost request. */
  onRespond: (token: string, approved: boolean) => Promise<void>;
  /** Called when the user toggles "Approve all for the session". Once on,
   *  every subsequent approval is auto-approved upstream by the caller. */
  onApproveAllSession?: () => void;
  /** When true, suppresses the modal (used when a parent has already
   *  opted into session-wide approval — they still listen for requests
   *  but auto-respond rather than showing the modal). */
  sessionApproveAll?: boolean;
}

/** Tiny inline diff preview. Shows the old and new content stacked with
 *  leading `- ` / `+ ` markers. Not a character-level diff — enough for
 *  the user to see what's changing without pulling in a diff library. */
function renderDiff(oldText: string, newText: string): React.ReactElement {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const max = Math.max(oldLines.length, newLines.length);
  const rows: React.ReactElement[] = [];
  for (let i = 0; i < max; i += 1) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) {
      rows.push(
        <div key={`eq-${i}`} className="text-muted-foreground">
          {'  '}
          {o ?? ''}
        </div>,
      );
    } else {
      if (o !== undefined) {
        rows.push(
          <div key={`old-${i}`} className="text-destructive">
            - {o}
          </div>,
        );
      }
      if (n !== undefined) {
        rows.push(
          <div key={`new-${i}`} className="text-emerald-600 dark:text-emerald-400">
            + {n}
          </div>,
        );
      }
    }
  }
  return (
    <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words">
      {rows}
    </pre>
  );
}

export function McpApprovalModal({
  approvals,
  onRespond,
  onApproveAllSession,
  sessionApproveAll,
}: McpApprovalModalProps): React.ReactElement | null {
  const { t } = useTranslation();
  // Auto-approve drains the queue when the session flag is on.
  useEffect(() => {
    if (!sessionApproveAll || approvals.length === 0) return;
    // Fire-and-forget; failures are surfaced the next poll cycle.
    for (const a of approvals) {
      void onRespond(a.token, true);
    }
  }, [approvals, sessionApproveAll, onRespond]);

  const [busy, setBusy] = useState(false);

  const topmost = useMemo(() => {
    if (sessionApproveAll) return null;
    return approvals[0] ?? null;
  }, [approvals, sessionApproveAll]);

  if (!topmost) return null;

  const handleApprove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onRespond(topmost.token, true);
    } finally {
      setBusy(false);
    }
  };
  const handleDeny = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onRespond(topmost.token, false);
    } finally {
      setBusy(false);
    }
  };
  const handleApproveAll = () => {
    onApproveAllSession?.();
    void handleApprove();
  };

  const moreCount = Math.max(0, approvals.length - 1);

  return (
    <Dialog open={true}>
      <DialogContent
        data-testid="mcp-approval-modal"
        className="max-w-2xl w-[92vw] p-0 flex flex-col overflow-hidden"
      >
        <div className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <span>{t('settings.mcp-approval.title')}</span>
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs">
            {t('settings.mcp-approval.description')}
          </DialogDescription>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto max-h-[60vh]">
          <div className="flex items-center gap-2 text-sm">
            {topmost.fileExists ? (
              <FilePen className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <FilePlus2 className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <code
              data-testid="mcp-approval-path"
              className="px-1.5 py-0.5 rounded bg-muted font-mono text-[12px]"
            >
              {topmost.path}
            </code>
            <span className="text-xs text-muted-foreground">
              {t('settings.mcp-approval.bytes', { bytes: topmost.contentBytes.toLocaleString() })}
              {topmost.fileExists
                ? t('settings.mcp-approval.overwrite-suffix')
                : t('settings.mcp-approval.new-file-suffix')}
            </span>
          </div>

          <div
            data-testid="mcp-approval-preview"
            className="rounded-md border border-border/60 bg-muted/10 p-3 overflow-x-auto"
          >
            {topmost.fileExists
              ? renderDiff(topmost.oldPreview, topmost.preview)
              : (
                <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words text-emerald-600 dark:text-emerald-400">
                  {topmost.preview}
                </pre>
              )}
          </div>

          {moreCount > 0 && (
            <p
              data-testid="mcp-approval-queue-more"
              className="text-xs text-muted-foreground"
            >
              {t('settings.mcp-approval.more-queued', { count: moreCount })}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-end gap-2">
          <Button
            data-testid="mcp-deny-write"
            variant="outline"
            size="sm"
            onClick={() => {
              void handleDeny();
            }}
            disabled={busy}
            className="gap-1.5 text-xs"
          >
            <X className="h-3.5 w-3.5" />
            {t('settings.mcp-approval.deny')}
          </Button>
          {onApproveAllSession && (
            <Button
              data-testid="mcp-approve-all-session"
              variant="outline"
              size="sm"
              onClick={handleApproveAll}
              disabled={busy}
              className="gap-1.5 text-xs"
            >
              {t('settings.mcp-approval.approve-all-session')}
            </Button>
          )}
          <Button
            data-testid="mcp-approve-write"
            variant="default"
            size="sm"
            onClick={() => {
              void handleApprove();
            }}
            disabled={busy}
            className="gap-1.5 text-xs"
          >
            <Check className="h-3.5 w-3.5" />
            {t('settings.mcp-approval.approve-write')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default McpApprovalModal;
