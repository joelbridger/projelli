import { useState, useEffect, useCallback } from 'react';
import { useJourney } from './engine/useJourney';
import { buildProgressSteps } from './engine/progress';
import type { Chapter, ChapterContext, JourneyData } from './engine/types';
import { Button } from '@/ui/kp';
import { ConfirmDialog } from '@/ui/ConfirmDialog';

export interface JourneyHostProps {
  chapters: Chapter[];
  /** When true, skips animations. Derived from matchMedia when omitted. */
  reducedMotion?: boolean;
  onComplete: (data: JourneyData) => void;
  /** Called when the user confirms "Skip setup". */
  onExit: (data: JourneyData) => void;
}

/**
 * Shell that hosts the onboarding journey: progress strip, current chapter,
 * and a persistent "Skip setup" escape hatch with a gentle confirm.
 *
 * The host is the only piece allowed to touch window.matchMedia — the engine
 * (useJourney) stays pure and testable.
 */
export function JourneyHost({ chapters, reducedMotion: reducedMotionProp, onComplete, onExit }: JourneyHostProps) {
  // Derive reducedMotion from the OS preference when the prop is not provided
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof reducedMotionProp === 'boolean') return reducedMotionProp;
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  });

  // Keep in sync with OS preference changes (only when prop is not overriding)
  useEffect(() => {
    if (typeof reducedMotionProp === 'boolean') return;
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [reducedMotionProp]);

  // Use the prop if provided (allows tests to override without matchMedia)
  const reducedMotion = typeof reducedMotionProp === 'boolean' ? reducedMotionProp : prefersReducedMotion;

  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false);

  const journey = useJourney(chapters, {
    reducedMotion,
    onComplete,
    onSkip: onExit,
  });

  const { index, current, data, advance, goBack, skipAll, complete, setData } = journey;

  const ctx: ChapterContext = {
    advance,
    goBack,
    skipAll: () => setSkipConfirmOpen(true),
    complete,
    setData,
    data,
    reducedMotion,
  };

  const handleSkipConfirm = useCallback(() => {
    setSkipConfirmOpen(false);
    skipAll();
  }, [skipAll]);

  const handleSkipCancel = useCallback(() => {
    setSkipConfirmOpen(false);
  }, []);

  const steps = buildProgressSteps(chapters, index);

  return (
    <div
      className="kp-journey-host"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        backgroundColor: 'var(--color-background)',
        color: 'var(--color-foreground)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Header: progress strip + Skip setup */}
      <header
        className="kp-journey-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--kp-space-md) var(--kp-space-xl)',
          borderBottom: '1px solid var(--color-border)',
          gap: 'var(--kp-space-lg)',
        }}
      >
        {/* Progress strip */}
        <nav
          aria-label="Setup progress"
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-xs)', flex: 1 }}
        >
          {steps.map((step, i) => (
            <div
              key={step.id}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-xs)' }}
            >
              {/* Connector line between steps */}
              {i > 0 && (
                <div
                  aria-hidden="true"
                  style={{
                    height: 2,
                    width: 24,
                    borderRadius: 1,
                    backgroundColor: step.isCompleted
                      ? 'var(--kp-navy)'
                      : 'var(--color-border)',
                    transition: reducedMotion
                      ? 'none'
                      : `background-color var(--kp-duration-base) var(--kp-ease-standard)`,
                  }}
                />
              )}
              {/* Step marker */}
              <div
                aria-current={step.isCurrent ? 'step' : undefined}
                title={step.title}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: step.isCurrent
                    ? 'var(--kp-navy)'
                    : step.isCompleted
                      ? 'var(--kp-accent)'
                      : 'var(--color-border)',
                  transition: reducedMotion
                    ? 'none'
                    : `background-color var(--kp-duration-base) var(--kp-ease-standard)`,
                  flexShrink: 0,
                }}
              />
            </div>
          ))}
          {/* Current chapter title */}
          <span
            aria-live="polite"
            aria-atomic="true"
            style={{
              marginLeft: 'var(--kp-space-sm)',
              fontSize: 'var(--kp-font-sm)',
              fontWeight: 'var(--kp-weight-medium)',
              color: 'var(--color-foreground)',
              whiteSpace: 'nowrap',
            }}
          >
            {current.title}
          </span>
        </nav>

        {/* Skip setup */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSkipConfirmOpen(true)}
          aria-label="Skip setup"
          style={{ flexShrink: 0 }}
        >
          Skip setup
        </Button>
      </header>

      {/* Chapter content */}
      <main
        className="kp-journey-content"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: 'var(--kp-space-2xl) var(--kp-space-xl)',
        }}
      >
        {current.render(ctx)}
      </main>

      {/* Skip setup confirmation */}
      <ConfirmDialog
        open={skipConfirmOpen}
        onOpenChange={setSkipConfirmOpen}
        title="Skip setup?"
        description="You can finish setup any time in Settings."
        confirmLabel="Skip setup"
        cancelLabel="Continue setup"
        onConfirm={handleSkipConfirm}
        onCancel={handleSkipCancel}
      />
    </div>
  );
}
