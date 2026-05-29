/**
 * Stream D-web Group IV · Task 4.3
 *
 * Full-screen modal shown when the demo session reaches its limit (5 messages,
 * 10 minutes elapsed, or a `keepance:demo-limit-hit` event from the proxy).
 *
 * The modal frames the moment as success, not failure: the user has explored
 * the product. Three OS-specific download buttons make conversion obvious.
 * "Continue browsing" dismisses once and the modal returns on the next AI
 * action (DemoLimitGate handles re-arming). "Reset session" mints a fresh
 * proxy session token and clears the local message counter so the user can
 * keep poking around without an installer.
 *
 * Buttons all carry UTM params so Plausible can split download attribution
 * by surface (banner vs exit modal vs homepage hero).
 */

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { resetDemoSessionToken } from './demoSessionToken';
import { trackDemoDownloadClicked } from './demoPlausible';

const UTM_SUFFIX =
  '?utm_source=demo&utm_campaign=v2-launch&utm_content=exit_modal';

export const DEMO_EXIT_DOWNLOAD_URLS = {
  mac: `https://keepance.com/#download${UTM_SUFFIX}&os=mac`,
  windows: `https://keepance.com/#download${UTM_SUFFIX}&os=windows`,
  linux: `https://keepance.com/#download${UTM_SUFFIX}&os=linux`,
} as const;

export const DEMO_MESSAGE_COUNT_STORAGE_KEY = 'keepance:demo:messageCount';

interface DemoExitModalProps {
  open: boolean;
  onContinueBrowsing: () => void;
  onReset: () => void;
}

export function DemoExitModal({
  open,
  onContinueBrowsing,
  onReset,
}: DemoExitModalProps) {
  function handleReset() {
    resetDemoSessionToken();
    try {
      localStorage.removeItem(DEMO_MESSAGE_COUNT_STORAGE_KEY);
    } catch {
      // tolerate private browsing / quota
    }
    onReset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onContinueBrowsing();
      }}
    >
      <DialogContent
        data-testid="demo-exit-modal"
        className="max-w-xl"
        onEscapeKeyDown={(e) => {
          // Allow Escape to behave like "Continue browsing" rather than
          // closing without dispatching the dismiss handler.
          e.preventDefault();
          onContinueBrowsing();
        }}
      >
        <DialogHeader>
          <DialogTitle>You have explored Keepance.</DialogTitle>
          <DialogDescription>
            The demo gives you a taste. The desktop app gives you the full
            tool: unlimited AI with your own key, every chat saved as real
            files on your hard drive, and no rate limits.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button asChild data-testid="demo-exit-download-mac">
            <a
              href={DEMO_EXIT_DOWNLOAD_URLS.mac}
              rel="noopener"
              onClick={() => {
                trackDemoDownloadClicked('exit_modal', 'mac');
              }}
            >
              Download for Mac
            </a>
          </Button>
          <Button asChild data-testid="demo-exit-download-windows">
            <a
              href={DEMO_EXIT_DOWNLOAD_URLS.windows}
              rel="noopener"
              onClick={() => {
                trackDemoDownloadClicked('exit_modal', 'windows');
              }}
            >
              Download for Windows
            </a>
          </Button>
          <Button asChild data-testid="demo-exit-download-linux">
            <a
              href={DEMO_EXIT_DOWNLOAD_URLS.linux}
              rel="noopener"
              onClick={() => {
                trackDemoDownloadClicked('exit_modal', 'linux');
              }}
            >
              Download for Linux
            </a>
          </Button>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            onClick={handleReset}
            data-testid="demo-exit-reset-session"
          >
            Reset session
          </Button>
          <Button
            variant="outline"
            onClick={onContinueBrowsing}
            data-testid="demo-exit-continue-browsing"
          >
            Continue browsing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
