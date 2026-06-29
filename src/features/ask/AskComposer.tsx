/**
 * AskComposer — the single Ask input, rendered in one of two positions:
 *
 *   variant="centered"  Big, centered in the conversation area when the thread
 *                       is empty (the ChatGPT "What do you want to find?" shape).
 *   variant="bottom"    A sticky bar pinned to the bottom of the conversation
 *                       once the thread has any turns (or a first answer is
 *                       streaming).
 *
 * Both variants render the SAME controls (scope pills, the search input, the
 * submit button, and the egress/privacy indicator) so there is exactly one
 * composer in the DOM at a time and the input ref / submit handler are shared.
 * This is a layout-only split: no backend or state change lives here.
 */

import type { CSSProperties, KeyboardEvent, RefObject } from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';
import { Button, SearchField } from '@/ui/kp';
import { ScopeToggle } from './ScopeToggle';
import { EgressIndicator } from '@/platform/privacy/ui/EgressIndicator';
import type { ConfidentialityMode } from '@/platform/privacy/egress';
import type { AskScope } from './askHelpers';

export interface AskComposerProps {
  variant: 'centered' | 'bottom';
  /** Scope pills. */
  askScope: AskScope;
  setAskScope: (s: AskScope) => void;
  hasMatter: boolean;
  isSample: boolean;
  /** Input. */
  inputRef: RefObject<HTMLInputElement>;
  question: string;
  onQuestionChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
  placeholder: string;
  ariaLabel: string;
  isBusy: boolean;
  status: 'idle' | 'retrieving' | 'answering' | 'done' | 'error';
  /** Submit button text in the idle state (the localized "Ask" verb). */
  submitLabel: string;
  /** Egress / privacy indicator — where the next AI request will travel. */
  egressProvider: string | null;
  egressMode: ConfidentialityMode;
}

export function AskComposer({
  variant,
  askScope,
  setAskScope,
  hasMatter,
  isSample,
  inputRef,
  question,
  onQuestionChange,
  onKeyDown,
  onSubmit,
  placeholder,
  ariaLabel,
  isBusy,
  status,
  submitLabel,
  egressProvider,
  egressMode,
}: AskComposerProps) {
  const centered = variant === 'centered';

  const submitText =
    status === 'retrieving' ? 'Searching…' : status === 'answering' ? 'Answering…' : submitLabel;

  // The input + submit row — identical controls, sized up a touch when centered.
  const inputRow = (
    <div style={{ display: 'flex', gap: 'var(--kp-space-sm)', width: '100%', alignItems: 'center' }}>
      <SearchField
        ref={inputRef}
        icon={Sparkles}
        value={question}
        onChange={onQuestionChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={isBusy}
        aria-label={ariaLabel}
        data-testid="ask-composer-input"
        size="md"
        style={{ flex: 1, minWidth: 0 }}
      />
      <Button
        variant="primary"
        size={centered ? 'lg' : 'md'}
        onClick={onSubmit}
        disabled={isBusy || !question.trim()}
        loading={isBusy}
        iconLeft={isBusy ? undefined : ArrowRight}
        aria-label={
          status === 'retrieving' ? 'Searching your documents' : status === 'answering' ? 'Answering' : undefined
        }
        data-testid="ask-composer-submit"
        style={{ flexShrink: 0 }}
      >
        <span role={isBusy ? 'status' : undefined}>{submitText}</span>
      </Button>
    </div>
  );

  if (centered) {
    return (
      <div
        data-testid="ask-composer"
        data-variant="centered"
        style={{
          width: '100%',
          maxWidth: 680,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--kp-space-sm)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <ScopeToggle scope={askScope} onChange={setAskScope} hasMatter={hasMatter} isSample={isSample} />
        </div>
        {inputRow}
        <EgressIndicator provider={egressProvider} mode={egressMode} variant="full" />
      </div>
    );
  }

  // variant === 'bottom' — sticky bar pinned to the bottom of the conversation.
  const barStyle: CSSProperties = {
    flexShrink: 0,
    borderTop: '1px solid var(--kp-divider)',
    background: 'var(--color-background)',
    padding: 'var(--kp-space-sm) var(--kp-gutter)',
  };

  return (
    <div data-testid="ask-composer" data-variant="bottom" style={barStyle}>
      <div
        style={{
          maxWidth: 820,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--kp-space-xs)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--kp-space-sm)',
            flexWrap: 'wrap',
          }}
        >
          <ScopeToggle scope={askScope} onChange={setAskScope} hasMatter={hasMatter} isSample={isSample} />
          {/* The full, honest privacy badge follows the composer wherever it sits
              (the load-bearing egress guarantee must always be the inspectable
              `egress-indicator`, never the abbreviated mirror). */}
          <EgressIndicator provider={egressProvider} mode={egressMode} variant="full" />
        </div>
        {inputRow}
      </div>
    </div>
  );
}
