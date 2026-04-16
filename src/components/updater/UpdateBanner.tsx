/**
 * Subtle top-of-app update banner.
 *
 * Three states map directly to the updater store's status enum:
 *   - 'available'        → Install / See changes / Later
 *   - 'downloading'      → progress bar + percent
 *   - 'ready-to-restart' → Restart now / Restart later
 *
 * Hidden when no update is available, when the user dismissed this
 * session, or when the underlying update has been cleared. Subtle in
 * design — appears as a thin pill at the top of the workspace, never
 * blocking interaction.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useUpdaterStore } from '@/stores/updaterStore';
import { Download, RefreshCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UpdateReleaseNotesModal } from './UpdateReleaseNotesModal';

export function UpdateBanner() {
  const status = useUpdaterStore((s) => s.status);
  const available = useUpdaterStore((s) => s.available);
  const dismissed = useUpdaterStore((s) => s.dismissedThisSession);
  const progress = useUpdaterStore((s) => s.downloadProgress);
  const dismiss = useUpdaterStore((s) => s.dismiss);
  const downloadAndInstall = useUpdaterStore((s) => s.downloadAndInstall);
  const restart = useUpdaterStore((s) => s.restart);

  const [showReleaseNotes, setShowReleaseNotes] = useState(false);

  // Hide cases. Banner only appears when there's a relevant state to show.
  if (!available || dismissed) return null;
  if (status === 'idle' || status === 'checking' || status === 'error') return null;

  const version = available.version;
  const percent = progress.total > 0
    ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
    : 0;

  return (
    <>
      <div
        data-testid="update-banner"
        data-status={status}
        className={cn(
          'flex items-center justify-between gap-3 px-4 py-2',
          'border-b bg-amber-50 dark:bg-amber-950/30 text-sm'
        )}
        role="status"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Download className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          {status === 'available' && (
            <span className="truncate">
              <span className="font-medium">Projelli {version}</span> is available
            </span>
          )}
          {status === 'downloading' && (
            <span className="truncate flex items-center gap-2">
              <span className="font-medium">Downloading {version}</span>
              <span className="text-xs text-muted-foreground">{percent}%</span>
              <span className="hidden sm:inline-block w-32 h-1.5 bg-amber-200 dark:bg-amber-900 rounded-full overflow-hidden">
                <span
                  className="block h-full bg-amber-500 transition-all"
                  style={{ width: `${percent}%` }}
                  data-testid="update-progress-bar"
                />
              </span>
            </span>
          )}
          {status === 'ready-to-restart' && (
            <span className="truncate">
              <span className="font-medium">Update ready</span> — restart to apply
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {status === 'available' && (
            <>
              <Button
                data-testid="update-banner-see-changes"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setShowReleaseNotes(true)}
              >
                See what's changed
              </Button>
              <Button
                data-testid="update-banner-install"
                variant="default"
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={() => void downloadAndInstall()}
              >
                Install
              </Button>
              <Button
                data-testid="update-banner-later"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={dismiss}
              >
                Later
              </Button>
            </>
          )}
          {status === 'ready-to-restart' && (
            <>
              <Button
                data-testid="update-banner-restart"
                variant="default"
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={() => void restart()}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Restart now
              </Button>
              <Button
                data-testid="update-banner-restart-later"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={dismiss}
              >
                Restart later
              </Button>
            </>
          )}
          {status === 'downloading' && (
            <span className="text-xs text-muted-foreground" data-testid="update-banner-downloading">
              Please wait
            </span>
          )}
          <Button
            data-testid="update-banner-dismiss"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={dismiss}
            aria-label="Dismiss update banner"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <UpdateReleaseNotesModal
        open={showReleaseNotes}
        onOpenChange={setShowReleaseNotes}
        onInstall={() => {
          setShowReleaseNotes(false);
          void downloadAndInstall();
        }}
      />
    </>
  );
}
