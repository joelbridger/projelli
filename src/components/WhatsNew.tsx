/**
 * "What's new" toast + changelog modal (UX-20).
 *
 * Flow:
 *   1. On app load, `useWhatsNew` reads the current version from the bundled
 *      changelog and compares against `localStorage['projelli:lastSeenVersion']`.
 *   2. If the stored value is MISSING → this is a first-time user; we do
 *      NOT show the toast. We write the current version so they only see it
 *      on future updates.
 *   3. If the stored value is DIFFERENT from current → show a dismissible
 *      toast. Clicking "See what's new" opens the modal. Dismissing (X or
 *      the modal close) writes the current version to localStorage so the
 *      toast won't fire again for this release.
 *   4. If the stored value matches → do nothing.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Sparkles, X } from 'lucide-react';
import { CHANGELOG_ENTRIES, currentChangelog } from '@/content/changelog';

/** localStorage key for last-seen version. Prefixed so the app can pick
 * it out of mixed keys without matching heuristics. */
const LAST_SEEN_KEY = 'projelli:lastSeenVersion';

export interface WhatsNewState {
  toastOpen: boolean;
  modalOpen: boolean;
  version: string;
  openModal: () => void;
  dismissToast: () => void;
  closeModal: () => void;
}

export function useWhatsNew(): WhatsNewState {
  const current = currentChangelog();
  const version = current?.version ?? '0.0.0';

  const [toastOpen, setToastOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    // Gate: localStorage may not exist in non-browser environments.
    if (typeof window === 'undefined') return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LAST_SEEN_KEY);
    } catch {
      // localStorage disabled — treat as first-run.
      stored = null;
    }
    if (!stored) {
      // First-time user: persist and stay quiet. Future updates will fire
      // the toast because the stored value will then differ.
      try {
        localStorage.setItem(LAST_SEEN_KEY, version);
      } catch {
        // no-op
      }
      return;
    }
    if (stored !== version) {
      setToastOpen(true);
    }
    // Identical → no-op.
  }, [version]);

  const persistVersion = useCallback(() => {
    try {
      localStorage.setItem(LAST_SEEN_KEY, version);
    } catch {
      // no-op
    }
  }, [version]);

  const openModal = useCallback(() => {
    setModalOpen(true);
    setToastOpen(false);
    persistVersion();
  }, [persistVersion]);

  const dismissToast = useCallback(() => {
    setToastOpen(false);
    persistVersion();
  }, [persistVersion]);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    persistVersion();
  }, [persistVersion]);

  return {
    toastOpen,
    modalOpen,
    version,
    openModal,
    dismissToast,
    closeModal,
  };
}

export interface WhatsNewToastProps {
  open: boolean;
  version: string;
  onOpenModal: () => void;
  onDismiss: () => void;
}

export function WhatsNewToast({ open, version, onOpenModal, onDismiss }: WhatsNewToastProps) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div
      data-testid="whats-new-toast"
      className="fixed bottom-4 left-4 z-[99] max-w-sm rounded-md border bg-background shadow-lg p-3 flex items-center gap-3 text-sm"
      role="status"
    >
      <Sparkles className="h-4 w-4 text-primary flex-shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{t('whats-new.toast.updated-to', { version })}</p>
        <button
          type="button"
          data-testid="whats-new-toast-link"
          className="text-xs text-primary hover:underline"
          onClick={onOpenModal}
        >
          {t('whats-new.toast.see-whats-new')}
        </button>
      </div>
      <Button
        data-testid="whats-new-toast-dismiss"
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 flex-shrink-0"
        onClick={onDismiss}
        aria-label="Dismiss update notification"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export interface WhatsNewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WhatsNewModal({ open, onOpenChange }: WhatsNewModalProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="whats-new-modal"
        className="sm:max-w-[560px] max-h-[80vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t('whats-new.modal.title')}</DialogTitle>
          <DialogDescription>
            {t('whats-new.modal.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 mt-2">
          {CHANGELOG_ENTRIES.map((entry) => (
            <section
              key={entry.version}
              data-testid={`whats-new-entry-${entry.version}`}
            >
              <h3 className="text-sm font-semibold flex items-baseline gap-2">
                <span>v{entry.version}</span>
                <span className="text-xs text-muted-foreground font-normal">
                  {entry.date}
                </span>
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground list-disc pl-5">
                {entry.highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
