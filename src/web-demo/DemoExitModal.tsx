/**
 * Stream D-web Group IV · Task 4.3
 *
 * Full-screen modal shown when the demo session reaches its limit (5 messages,
 * 10 minutes elapsed, or a `lantern:demo-limit-hit` event from the proxy).
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

import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/ui/dialog';
import { resetDemoSessionToken } from './demoSessionToken';
import { trackDemoDownloadClicked } from './demoPlausible';
import { SK_DEMO_MESSAGE_COUNT } from '@/config/identity';
import { BRAND } from '@/config/brand';

const UTM_SUFFIX =
  '?utm_source=demo&utm_campaign=v2-launch&utm_content=exit_modal';

export const DEMO_EXIT_DOWNLOAD_URLS = {
  mac: `${BRAND.urls.download}${UTM_SUFFIX}&os=mac`,
  windows: `${BRAND.urls.download}${UTM_SUFFIX}&os=windows`,
  linux: `${BRAND.urls.download}${UTM_SUFFIX}&os=linux`,
} as const;

export const DEMO_MESSAGE_COUNT_STORAGE_KEY = SK_DEMO_MESSAGE_COUNT;

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
          {/* eslint-disable lantern-i18n/no-hardcoded-string */}
          <DialogTitle>What's one caught mistake worth?</DialogTitle>
          <DialogDescription>
            You just watched Advisor Prep Hero catch a beneficiary designation still
            pointing at an ex-spouse — the kind of miss that surfaces years
            later, in front of a client or a regulator. Catching one of those
            pays for the tool many times over. On your own client files, the
            desktop app gives you unlimited AI with your own key, every answer
            cited to its source, and nothing leaving your machine.
          </DialogDescription>
          {/* eslint-enable lantern-i18n/no-hardcoded-string */}
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
