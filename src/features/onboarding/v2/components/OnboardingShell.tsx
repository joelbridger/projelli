/**
 * OnboardingShell — the chrome around every OnboardingV2 scene.
 *
 * Owns: the full-screen light overlay, the decorative background (drifting
 * orbs + grain), the corner logo (revealed after the intro), the scrolling
 * content area, and the bottom navigation bar (Back · progress dots ·
 * Continue). Scenes render as `children`.
 *
 * Responsive (no fixed 1920x1080 stage like the standalone prototype): content
 * centers and scrolls so it works at any window size inside the desktop app.
 *
 * Keyboard: ArrowLeft/ArrowRight move between scenes, but ONLY when focus is
 * not inside a text field — so typing an API key or IMAP host is never
 * hijacked. There is intentionally no global Enter-to-advance (it would submit
 * forms unexpectedly).
 */

import { useEffect, useRef, type ReactNode } from 'react';

export interface OnboardingShellProps {
  children: ReactNode;
  showLogo: boolean;
  showBack: boolean;
  onBack: () => void;
  showContinue: boolean;
  continueLabel: string;
  onContinue: () => void;
  continueDisabled?: boolean;
  /** Total progress dots (one per action screen; 0 hides the dots). */
  dotCount: number;
  /** Active dot index (0-based), or -1 for the intro (no dot active). */
  activeDot: number;
  onDotClick?: (index: number) => void;
  /** Enables ArrowLeft/ArrowRight scene navigation. */
  onArrowNav?: (dir: -1 | 1) => void;
}

function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

// Focusable elements for the tab trap (mirrors the archived OnboardingStepFrame).
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function OnboardingShell({
  children,
  showLogo,
  showBack,
  onBack,
  showContinue,
  continueLabel,
  onContinue,
  continueDisabled,
  dotCount,
  activeDot,
  onDotClick,
  onArrowNav,
}: OnboardingShellProps) {
  useEffect(() => {
    if (!onArrowNav) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (isTextEntry(e.target)) return;
      if (e.key === 'ArrowRight') onArrowNav(1);
      else if (e.key === 'ArrowLeft') onArrowNav(-1);
    };
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); };
  }, [onArrowNav]);

  const shellRef = useRef<HTMLDivElement>(null);

  // Focus the overlay on mount; restore focus to whatever had it (e.g. the
  // WorkspaceSelector behind this modal) on unmount.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    shellRef.current?.focus();
    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  // Tab/Shift+Tab focus trap within the overlay, so keyboard users can't tab
  // out to the WorkspaceSelector controls behind it while aria-modal claims
  // focus is contained (mirrors the archived OnboardingStepFrame's trap).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const shell = shellRef.current;
      if (!shell) return;
      const focusable = Array.from(shell.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); };
  }, []);

  return (
    <div
      ref={shellRef}
      tabIndex={-1}
      className="kp-onbv2 fixed inset-0 z-50 flex flex-col outline-none"
      data-testid="onboarding-v2"
      role="dialog"
      aria-modal="true"
      aria-label="Set up Advisor Prep Hero"
    >
      {/* Decorative background */}
      <div className="kp-onbv2-bg" aria-hidden="true">
        <div className="kp-onbv2-orb kp-onbv2-orb--pink" />
        <div className="kp-onbv2-orb kp-onbv2-orb--blue" />
        <div className="kp-onbv2-grain" />
      </div>

      {/* Corner logo (after intro) */}
      <img
        src="/onboarding/app-logo.svg"
        alt="Advisor Prep Hero"
        className={`absolute left-10 top-9 z-10 h-7 transition-opacity duration-500 ${
          showLogo ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden={!showLogo}
      />

      {/* Scrolling content area */}
      <div className="kp-onbv2-scroll relative z-10 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-[1200px] flex-col items-center justify-center px-6 py-10 text-center">
          {children}
        </div>
      </div>

      {/* Bottom navigation */}
      <div className="relative z-10 flex h-24 shrink-0 items-center justify-between px-12">
        <div className="flex-1">
          {showBack ? (
            <button
              type="button"
              onClick={onBack}
              data-testid="onboarding-v2-back"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-base font-bold text-[var(--kp-navy)] shadow-[0_8px_24px_rgba(var(--kp-navy-rgb),0.10)] transition-transform active:translate-y-px"
            >
              &larr; Back
            </button>
          ) : null}
        </div>

        {dotCount > 0 ? (
          <div className="flex flex-1 items-center justify-center gap-3" data-testid="onboarding-v2-dots">
            {Array.from({ length: dotCount }, (_, i) => {
              const state = i === activeDot ? 'active' : i < activeDot ? 'done' : 'todo';
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={`Go to step ${String(i + 1)}`}
                  aria-current={state === 'active' ? 'step' : undefined}
                  onClick={onDotClick ? () => { onDotClick(i); } : undefined}
                  className={`h-2.5 rounded-full transition-all ${
                    state === 'active'
                      ? 'w-6 bg-[var(--kp-accent)]'
                      : state === 'done'
                        ? 'w-2.5 bg-[var(--kp-blue)]'
                        : 'w-2.5 bg-[rgba(var(--kp-navy-rgb),0.15)]'
                  }`}
                />
              );
            })}
          </div>
        ) : (
          <div className="flex-1" />
        )}

        <div className="flex flex-1 justify-end">
          {showContinue ? (
            <button
              type="button"
              onClick={onContinue}
              disabled={continueDisabled}
              data-testid="onboarding-v2-continue"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--kp-accent)] px-8 py-3 text-base font-bold text-white shadow-[0_12px_30px_rgba(var(--kp-navy-rgb),0.22)] transition-transform active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
            >
              {continueLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
