/**
 * PluginConsentDialog — modal shown right before a plugin install lands
 * on disk. Gives the user a single "yes / no" choice on the full
 * permission set the plugin's manifest declares.
 *
 * The dialog is purely presentational: it surfaces a manifest snapshot
 * and resolves a Promise<boolean> when the user picks. The `service.install`
 * upstream wiring (Group IV) is responsible for cleaning up the staged
 * tarball on a `false` answer and for emitting the corresponding audit
 * event.
 *
 * Two ways to consume:
 *   1. `<PluginConsentDialog ... />` directly with controlled `open` props.
 *   2. `usePluginConsentDialog()` hook that returns
 *      `{ confirm, dialog }`. Mount `dialog` once near the host, then call
 *      `await confirm(manifest)` from anywhere to drive it imperatively.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ShieldAlert } from 'lucide-react';
import type { PluginManifest } from '@/types/plugin';
import { PluginPermissionsList } from './PluginPermissionsList';

interface PluginConsentDialogProps {
  open: boolean;
  manifest: PluginManifest | null;
  onApprove: () => void;
  onCancel: () => void;
  /**
   * Called when the dialog open state changes via the overlay / Escape key /
   * either action. Components using the imperative hook do not need to wire
   * this; controlled callers must.
   */
  onOpenChange?: (open: boolean) => void;
}

export function PluginConsentDialog({
  open,
  manifest,
  onApprove,
  onCancel,
  onOpenChange,
}: PluginConsentDialogProps) {
  // Track which button caused the close so the AlertDialog's onOpenChange
  // fired by Radix on Approve / Cancel button click does NOT double-fire
  // onApprove or onCancel. The handler resets after consuming.
  const decisionRef = useRef<'approve' | 'cancel' | null>(null);

  const handleApprove = useCallback(() => {
    decisionRef.current = 'approve';
    onApprove();
  }, [onApprove]);

  const handleCancel = useCallback(() => {
    decisionRef.current = 'cancel';
    onCancel();
  }, [onCancel]);

  return (
    <AlertDialog
      open={open && manifest !== null}
      onOpenChange={(next) => {
        if (!next) {
          // Distinguish overlay / Escape close (no recorded decision) from
          // a button-triggered close (decision already fired its handler).
          const decided = decisionRef.current;
          decisionRef.current = null;
          if (decided === null) {
            onCancel();
          }
        }
        onOpenChange?.(next);
      }}
    >
      <AlertDialogContent
        data-testid="plugin-consent-dialog"
        className="max-w-lg"
      >
        {manifest ? (
          <>
            <AlertDialogHeader>
              <div className="flex items-center gap-2">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  aria-hidden="true"
                >
                  <ShieldAlert className="h-4 w-4" />
                </span>
                <AlertDialogTitle data-testid="plugin-consent-dialog-title">
                  Install &ldquo;{manifest.name}&rdquo; by {manifest.author.name}?
                </AlertDialogTitle>
              </div>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>
                    By approving, you trust this plugin with the permissions
                    listed below. You can revoke them at any time by
                    uninstalling the plugin.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-3">
              <PluginPermissionsList permissions={manifest.permissions} />
              <PluginConsentSourceLine manifest={manifest} />
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel
                data-testid="plugin-consent-dialog-cancel"
                onClick={handleCancel}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                data-testid="plugin-consent-dialog-approve"
                onClick={handleApprove}
              >
                Approve &amp; Install
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Source line
// ---------------------------------------------------------------------------

function PluginConsentSourceLine({ manifest }: { manifest: PluginManifest }) {
  const source = useMemo(() => formatSource(manifest), [manifest]);
  if (!source) return null;
  return (
    <p
      data-testid="plugin-consent-dialog-source"
      className="text-xs text-muted-foreground"
    >
      <span className="font-medium text-foreground/70">Source:</span> {source}
    </p>
  );
}

function formatSource(manifest: PluginManifest): string | null {
  // Prefer the manifest homepage if it's a github URL since that's the
  // most actionable thing for a user to inspect. Otherwise compose
  // `github.com/<user>/<id>` from author.githubUser + plugin id (best
  // guess; the catalog may present a richer source field in v2.x).
  if (manifest.homepage) {
    return stripScheme(manifest.homepage);
  }
  if (manifest.author.githubUser) {
    return `github.com/${manifest.author.githubUser}/${manifest.id}`;
  }
  return null;
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

// ---------------------------------------------------------------------------
// usePluginConsentDialog — imperative wrapper hook
// ---------------------------------------------------------------------------

interface UsePluginConsentDialogResult {
  /**
   * Open the dialog with the given manifest. Resolves to `true` if the
   * user clicked Approve, `false` for any other dismissal (Cancel,
   * Escape, overlay click, or being closed programmatically).
   */
  confirm: (manifest: PluginManifest) => Promise<boolean>;
  /** The element to mount in the host's tree exactly once. */
  dialog: ReactNode;
}

interface PendingPrompt {
  manifest: PluginManifest;
  resolve: (approved: boolean) => void;
}

/**
 * Imperative wrapper hook around `<PluginConsentDialog />`.
 *
 * The host component renders `dialog` once. Anywhere downstream, calling
 * `await confirm(manifest)` opens the modal and resolves to a boolean
 * when the user picks. Multiple concurrent calls are not supported —
 * the latest call replaces the prior pending one and the prior
 * promise resolves to `false`.
 */
export function usePluginConsentDialog(): UsePluginConsentDialogResult {
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  // Hold the latest pending prompt in a ref so the resolve callbacks fired
  // by the dialog don't capture a stale closure.
  const pendingRef = useRef<PendingPrompt | null>(null);

  const settle = useCallback((approved: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(approved);
  }, []);

  const confirm = useCallback(
    (manifest: PluginManifest): Promise<boolean> => {
      // Resolve any in-flight prompt as cancelled before opening a new one.
      const previous = pendingRef.current;
      if (previous) {
        pendingRef.current = null;
        previous.resolve(false);
      }
      return new Promise<boolean>((resolve) => {
        const next: PendingPrompt = { manifest, resolve };
        pendingRef.current = next;
        setPending(next);
      });
    },
    [],
  );

  const dialog = (
    <PluginConsentDialog
      open={pending !== null}
      manifest={pending?.manifest ?? null}
      onApprove={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, dialog };
}
