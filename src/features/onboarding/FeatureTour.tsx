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
import { useState, useEffect, useMemo, useLayoutEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
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

  // Stable advance callback — defined before any conditional return so hook
  // order is consistent across renders. This prevents AutoAdvance's useEffect
  // from re-firing every render (the old inline function was a new reference
  // each render, causing an infinite loop when the target was missing).
  const handleAutoAdvance = useCallback(() => {
    if (isLast) {
      onComplete();
      onClose();
    } else {
      setStepIndex((i) => i + 1);
    }
  }, [isLast, onComplete, onClose]);

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
    return () => { window.removeEventListener('keydown', handler); };
  }, [open, isFirst, isLast, onSkip, onComplete, onClose]);

  if (!open) return null;

  if (step.placement === 'center') {
    return (
      <Dialog open onOpenChange={(v) => { if (!v) { onSkip(); onClose(); } }}>
        <DialogContent data-testid="feature-tour-center" className="max-w-md">
          <DialogTitle className="sr-only">{step.title}</DialogTitle>
          <DialogDescription className="sr-only">{step.body}</DialogDescription>
          <FeatureTourBody
            step={step}
            stepIndex={stepIndex}
            totalSteps={FEATURE_TOUR_STEPS.length}
            isFirst={isFirst}
            isLast={isLast}
            onBack={() => { setStepIndex((i) => i - 1); }}
            onNext={() => { setStepIndex((i) => i + 1); }}
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
    console.warn(`[FeatureTour] target ${String(step.targetSelector)} not found; auto-advancing`);
    return <AutoAdvance onAdvance={handleAutoAdvance} />;
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
        onBack={() => { setStepIndex((i) => i - 1); }}
        onNext={() => { setStepIndex((i) => i + 1); }}
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
    const update = () => { setRect(target.getBoundingClientRect()); };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [target]);

  if (!rect) return null;

  const BUBBLE_WIDTH = 360;
  const BUBBLE_HEIGHT_ESTIMATE = 200;
  const GAP = 12;
  const MARGIN = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // First try the requested placement. If it puts the bubble off-screen,
  // auto-flip to the opposite side. Then clamp to viewport.
  const spaceRight = vw - rect.right - GAP;
  const spaceLeft = rect.left - GAP;
  const spaceBottom = vh - rect.bottom - GAP;
  const spaceTop = rect.top - GAP;

  let actualPlacement = placement;
  if (placement === 'left' && spaceLeft < BUBBLE_WIDTH && spaceRight >= BUBBLE_WIDTH) {
    actualPlacement = 'right';
  } else if (placement === 'right' && spaceRight < BUBBLE_WIDTH && spaceLeft >= BUBBLE_WIDTH) {
    actualPlacement = 'left';
  } else if (placement === 'top' && spaceTop < BUBBLE_HEIGHT_ESTIMATE && spaceBottom >= BUBBLE_HEIGHT_ESTIMATE) {
    actualPlacement = 'bottom';
  } else if (placement === 'bottom' && spaceBottom < BUBBLE_HEIGHT_ESTIMATE && spaceTop >= BUBBLE_HEIGHT_ESTIMATE) {
    actualPlacement = 'top';
  }

  let bubbleLeft = 0;
  let bubbleTop = 0;
  switch (actualPlacement) {
    case 'top':
      bubbleTop = rect.top - BUBBLE_HEIGHT_ESTIMATE - GAP;
      bubbleLeft = rect.left + rect.width / 2 - BUBBLE_WIDTH / 2;
      break;
    case 'bottom':
      bubbleTop = rect.bottom + GAP;
      bubbleLeft = rect.left + rect.width / 2 - BUBBLE_WIDTH / 2;
      break;
    case 'left':
      bubbleLeft = rect.left - BUBBLE_WIDTH - GAP;
      bubbleTop = rect.top + rect.height / 2 - BUBBLE_HEIGHT_ESTIMATE / 2;
      break;
    case 'right':
      bubbleLeft = rect.right + GAP;
      bubbleTop = rect.top + rect.height / 2 - BUBBLE_HEIGHT_ESTIMATE / 2;
      break;
  }

  // Clamp into viewport so the bubble is always visible.
  bubbleLeft = Math.max(MARGIN, Math.min(bubbleLeft, vw - BUBBLE_WIDTH - MARGIN));
  bubbleTop = Math.max(MARGIN, Math.min(bubbleTop, vh - BUBBLE_HEIGHT_ESTIMATE - MARGIN));

  const bubbleStyle: React.CSSProperties = {
    position: 'fixed',
    top: bubbleTop,
    left: bubbleLeft,
    width: BUBBLE_WIDTH,
    zIndex: 10001,
    backgroundColor: 'hsl(var(--popover, 0 0% 100%))',
    color: 'hsl(var(--popover-foreground, 222 47% 11%))',
    border: '1px solid hsl(var(--border, 214 32% 91%))',
    borderRadius: 8,
    padding: 16,
    boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
  };

  const highlightStyle: React.CSSProperties = {
    position: 'fixed',
    top: rect.top - 4,
    left: rect.left - 4,
    width: rect.width + 8,
    height: rect.height + 8,
    pointerEvents: 'none',
    border: '2px solid #FF7C6E',
    borderRadius: 6,
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
    zIndex: 10000,
  };

  // Portal to body so fixed positioning isn't trapped by any parent
  // transform/filter/contain that would change the containing block.
  return createPortal(
    <>
      <div style={highlightStyle} aria-hidden />
      <div style={bubbleStyle} data-testid={testid}>
        {children}
      </div>
    </>,
    document.body,
  );
}

function AutoAdvance({ onAdvance }: { onAdvance: () => void }) {
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onAdvance();
  }, [onAdvance]);
  return null;
}
