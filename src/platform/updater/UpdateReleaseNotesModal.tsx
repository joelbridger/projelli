/**
 * Release notes modal for an available update.
 *
 * Renders the markdown body from the GitHub release as plain text inside
 * a Radix Dialog. We intentionally don't pull a markdown renderer into the
 * bundle just for this — release notes are short and pre-wrap is enough.
 *
 * Has a real DialogTitle + DialogDescription so Radix never logs a11y
 * warnings (UX-30).
 */

import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { useUpdaterStore } from '@/platform/updater/updaterStore';
import { Sparkles } from 'lucide-react';
import { BRAND } from '@/config/brand';

export interface UpdateReleaseNotesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstall: () => void;
}

export function UpdateReleaseNotesModal({
  open,
  onOpenChange,
  onInstall,
}: UpdateReleaseNotesModalProps) {
  const available = useUpdaterStore((s) => s.available);
  const version = available?.version ?? '';
  const date = available?.date;
  const body = available?.body ?? '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="update-release-notes-modal"
        className="sm:max-w-[560px] max-h-[80vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-700" />
            <span>{BRAND.name} {version}</span>
          </DialogTitle>
          <DialogDescription>
            {date
              ? `Released ${date}. Here's what changed since your current version.`
              : "Here's what changed since your current version."}
          </DialogDescription>
        </DialogHeader>
        <div
          data-testid="update-release-notes-body"
          className="mt-3 text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed"
        >
          {body || 'Release notes are not available for this update.'}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            data-testid="update-release-notes-later"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Later
          </Button>
          <Button
            data-testid="update-release-notes-install"
            size="sm"
            onClick={onInstall}
          >
            Install now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
