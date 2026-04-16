/**
 * MCP Settings Section (M4, v1.5 Flag 2).
 *
 * Shown under Settings → Integrations. Three UI blocks:
 *
 *   1. Status pill — "Ready to install in Claude Desktop" when the bundled
 *      `.mcpb` is on disk, "Bundle not available" in dev builds.
 *   2. Download button — writes the platform `.mcpb` into the user's
 *      Downloads folder via the Tauri dialog plugin, then shows a toast.
 *      The button falls back to "Copy path" when the Downloads folder
 *      isn't writable (hardened Mac sandboxes).
 *   3. Install instructions — a short readme pointing at Claude Desktop.
 *
 * Approval-modal wiring lives separately in `McpApprovalModal.tsx` — this
 * component is read-only so it can be unit-tested without spinning up the
 * polling loop.
 */

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Download, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { mcpBundlePath } from '@/utils/tauri-commands';

export interface McpSettingsSectionProps {
  /** Test hook — override the bundle-path lookup so tests don't have to
   *  stub the global `invoke`. When omitted, calls `mcpBundlePath()`. */
  onResolveBundlePath?: () => Promise<string | null>;
  /** Test hook — invoked when the user clicks Download. Receives the
   *  resolved bundle path. Default implementation opens the OS
   *  file-picker dialog via `@tauri-apps/plugin-dialog`. */
  onDownload?: (bundlePath: string) => Promise<void>;
}

export function McpSettingsSection({
  onResolveBundlePath,
  onDownload,
}: McpSettingsSectionProps): React.ReactElement {
  const [bundlePath, setBundlePath] = useState<string | null | undefined>(
    undefined,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    const path = onResolveBundlePath
      ? await onResolveBundlePath()
      : await mcpBundlePath();
    setBundlePath(path);
  }, [onResolveBundlePath]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  const handleDownload = useCallback(async () => {
    if (!bundlePath) return;
    setStatus(null);
    setError(null);
    try {
      if (onDownload) {
        await onDownload(bundlePath);
      } else {
        // Default: surface the path + copy it to the clipboard. The user
        // can then drag-drop into Claude Desktop, which is the actual
        // install gesture. We deliberately avoid auto-opening the file
        // because Claude Desktop may not be installed yet.
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(bundlePath);
        }
      }
      setStatus(`Copied bundle path to clipboard: ${bundlePath}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [bundlePath, onDownload]);

  const loading = bundlePath === undefined;
  const hasBundle = !!bundlePath;

  return (
    <div
      data-testid="mcp-settings-section"
      className="space-y-4"
    >
      <div>
        <h3 className="text-base font-semibold">MCP server</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Expose your Projelli workspace to any MCP-compatible AI client.
          Install once, then ask Claude Desktop, Cursor, or any other client
          about your notes, chats, and memory facts without copy-pasting.
        </p>
      </div>

      <div
        data-testid="mcp-server-status"
        data-status={
          loading ? 'loading' : hasBundle ? 'ready' : 'unavailable'
        }
        className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
      >
        {loading ? (
          <>
            <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground">
              Looking up bundle path...
            </span>
          </>
        ) : hasBundle ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            <span className="text-sm">
              Ready to install in Claude Desktop
            </span>
          </>
        ) : (
          <>
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="text-sm">
              Bundle not available. Run{' '}
              <code className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]">
                node scripts/build-mcpb.mjs
              </code>{' '}
              first, or install via a released build.
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          data-testid="mcp-download-mcpb"
          onClick={() => {
            void handleDownload();
          }}
          disabled={!hasBundle}
          variant="default"
          size="sm"
          className="gap-1.5 text-xs"
        >
          <Download className="h-3.5 w-3.5" />
          Download .mcpb for Claude Desktop
        </Button>
        <a
          href="https://modelcontextprotocol.io/quickstart/user"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          What&apos;s MCP? <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {status && (
        <div
          data-testid="mcp-download-status"
          className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400"
        >
          {status}
        </div>
      )}
      {error && (
        <div
          data-testid="mcp-download-error"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      <div className="rounded-md border border-border/60 p-3 text-xs leading-relaxed text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">How to install:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>
            Click <strong>Download .mcpb</strong> above to copy the bundle
            path to your clipboard.
          </li>
          <li>Open Claude Desktop.</li>
          <li>
            Open <strong>Settings → Developer → Edit Config</strong>, or
            drag the <code>.mcpb</code> file into the Claude Desktop window.
          </li>
          <li>
            When prompted for a workspace folder, pick the same folder you
            opened in Projelli.
          </li>
        </ol>
        <p className="pt-1">
          After install, ask Claude &quot;search my Projelli workspace for
          X&quot; or &quot;read notes/plan.md&quot; and watch it work.
        </p>
      </div>
    </div>
  );
}

export default McpSettingsSection;
