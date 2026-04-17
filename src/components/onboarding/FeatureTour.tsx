/**
 * FeatureTour — 5-step popover-based onboarding tour shown after the
 * first-run wizard completes. Built on shadcn Dialog primitives plus a
 * lightweight fixed-position bubble for anchored steps (we don't have
 * Radix Popover installed and a single-purpose tour didn't justify a
 * new dependency).
 *
 * Steps: see featureTourSteps.ts. Auto-advance happens if a target
 * selector returns no element (e.g. the AI tab isn't mounted yet).
 */
import { useState, useEffect, useMemo, useLayoutEffect } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FEATURE_TOUR_STEPS, type FeatureTourStep } from './featureTourSteps';

export interface FeatureTourProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  onSkip: () => void;
}

export function FeatureTour({ open, onClose, onComplete, onSkip }: FeatureTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = FEATURE_TOUR_STEPS[stepIndex] ?? FEATURE_TOUR_STEPS[0]!;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === FEATURE_TOUR_STEPS.length - 1;

  // Reset to first step whenever the tour reopens.
  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open]);

  const targetElement = useMemo<Element | null>(() => {
    if (!step.targetSelector) return null;
    return document.querySelector(step.targetSelector);
  }, [step.targetSelector, open, stepIndex]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSkip();
        onClose();
      }
      if (e.key === 'ArrowRight' && !isLast) setStepIndex((i) => i + 1);
      if (e.key === 'ArrowLeft' && !isFirst) setStepIndex((i) => i - 1);
      if (e.key === 'Enter' && isLast) {
        onComplete();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, isFirst, isLast, onSkip, onComplete, onClose]);

  if (!open) return null;

  if (step.placement === 'center') {
    return (
      <Dialog open onOpenChange={(v) => !v && (onSkip(), onClose())}>
        <DialogContent data-testid="feature-tour-center" className="max-w-md">
          <DialogTitle className="sr-only">{step.title}</DialogTitle>
          <DialogDescription className="sr-only">{step.body}</DialogDescription>
          <FeatureTourBody
            step={step}
            stepIndex={stepIndex}
            totalSteps={FEATURE_TOUR_STEPS.length}
            isFirst={isFirst}
            isLast={isLast}
            onBack={() => setStepIndex((i) => i - 1)}
            onNext={() => setStepIndex((i) => i + 1)}
            onSkip={() => {
              onSkip();
              onClose();
            }}
            onFinish={() => {
              onComplete();
              onClose();
            }}
          />
        </DialogContent>
      </Dialog>
    );
  }

  if (!targetElement) {
    console.warn(`[FeatureTour] target ${step.targetSelector} not found; auto-advancing`);
    return (
      <AutoAdvance
        onAdvance={() => {
          if (isLast) {
            onComplete();
            onClose();
          } else {
            setStepIndex((i) => i + 1);
          }
        }}
      />
    );
  }

  return (
    <AnchoredBubble
      target={targetElement}
      placement={step.placement}
      testid={`feature-tour-step-${step.id}`}
    >
      <FeatureTourBody
        step={step}
        stepIndex={stepIndex}
        totalSteps={FEATURE_TOUR_STEPS.length}
        isFirst={isFirst}
        isLast={isLast}
        onBack={() => setStepIndex((i) => i - 1)}
        onNext={() => setStepIndex((i) => i + 1)}
        onSkip={() => {
          onSkip();
          onClose();
        }}
        onFinish={() => {
          onComplete();
          onClose();
        }}
      />
    </AnchoredBubble>
  );
}

interface FeatureTourBodyProps {
  step: FeatureTourStep;
  stepIndex: number;
  totalSteps: number;
  isFirst: boolean;
  isLast: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
}

function FeatureTourBody({
  step,
  stepIndex,
  totalSteps,
  isFirst,
  isLast,
  onBack,
  onNext,
  onSkip,
  onFinish,
}: FeatureTourBodyProps) {
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Step {stepIndex + 1} of {totalSteps}
      </div>
      <h3 className="font-semibold text-lg">{step.title}</h3>
      <p className="text-sm text-muted-foreground">{step.body}</p>
      <div className="flex items-center justify-between pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onSkip}
          data-testid="feature-tour-skip"
        >
          Skip tour
        </Button>
        <div className="flex gap-2">
          {!isFirst && (
            <Button variant="outline" size="sm" onClick={onBack} data-testid="feature-tour-back">
              Back
            </Button>
          )}
          {!isLast ? (
            <Button size="sm" onClick={onNext} data-testid="feature-tour-next">
              Next
            </Button>
          ) : (
            <Button size="sm" onClick={onFinish} data-testid="feature-tour-finish">
              Finish
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface AnchoredBubbleProps {
  target: Element;
  placement: 'top' | 'bottom' | 'left' | 'right';
  testid: string;
  children: React.ReactNode;
}

function AnchoredBubble({ target, placement, testid, children }: AnchoredBubbleProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const update = () => setRect(target.getBoundingClientRect());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [target]);

  if (!rect) return null;

  const gap = 12;
  const bubbleStyle: React.CSSProperties = { position: 'fixed', zIndex: 60, width: 360 };
  switch (placement) {
    case 'top':
      bubbleStyle.bottom = window.innerHeight - rect.top + gap;
      bubbleStyle.left = Math.max(8, rect.left + rect.width / 2 - 180);
      break;
    case 'bottom':
      bubbleStyle.top = rect.bottom + gap;
      bubbleStyle.left = Math.max(8, rect.left + rect.width / 2 - 180);
      break;
    case 'left':
      bubbleStyle.right = window.innerWidth - rect.left + gap;
      bubbleStyle.top = Math.max(8, rect.top + rect.height / 2 - 80);
      break;
    case 'right':
      bubbleStyle.left = rect.right + gap;
      bubbleStyle.top = Math.max(8, rect.top + rect.height / 2 - 80);
      break;
  }

  const highlightStyle: React.CSSProperties = {
    position: 'fixed',
    top: rect.top - 4,
    left: rect.left - 4,
    width: rect.width + 8,
    height: rect.height + 8,
    pointerEvents: 'none',
    border: '2px solid rgb(247, 99, 82)',
    borderRadius: 6,
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
    zIndex: 50,
  };

  return (
    <>
      <div style={highlightStyle} aria-hidden />
      <div
        style={bubbleStyle}
        data-testid={testid}
        className="rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-4"
      >
        {children}
      </div>
    </>
  );
}

function AutoAdvance({ onAdvance }: { onAdvance: () => void }) {
  useEffect(() => {
    onAdvance();
  }, [onAdvance]);
  return null;
}
