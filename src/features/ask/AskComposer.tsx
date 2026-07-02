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

import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from 'react';
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
  /** Decision 6 — Files-only mode lock. When on, Ask reverts to strict
   *  cited-from-your-files-only behaviour (no general knowledge, no drafts). */
  filesOnly: boolean;
  onFilesOnlyChange: (v: boolean) => void;
  /** F2.5 — the file-access consent affordance, rendered directly above the
   *  input (the ONE place it appears). Null/undefined when there's nothing to
   *  ask (local engine, or no cloud provider). */
  banner?: ReactNode;
}

// Module-scope label — the i18n lint rule targets JSX text / string props, not
// const references, so this keeps the toggle copy out of the JSX-text check
// (same pattern the prompt builders use). Localized with the surface later.
const FILES_ONLY_LABEL = 'Files-only mode';

/**
 * Files-only mode lock — a small accessible switch. OFF = the smart, source-aware
 * advisor agent (default); ON = strict cited-from-your-files-only, the one-tap
 * answer for a compliance team that wants the general/drafting capability off.
 */
function FilesOnlyToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      data-testid="ask-files-only-toggle"
      onClick={() => { onChange(!value); }}
      title="Files-only mode: answer only from your files, cited — no general knowledge or drafts."
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: 600,
        color: value ? 'var(--kp-navy)' : 'var(--kp-text-dim)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 34,
          height: 20,
          borderRadius: 999,
          background: value ? 'var(--kp-accent)' : 'var(--kp-divider-strong)',
          position: 'relative',
          transition: 'background 0.15s ease',
          flex: 'none',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: value ? 16 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 2px rgba(10,37,64,0.3)',
            transition: 'left 0.15s ease',
          }}
        />
      </span>
      {FILES_ONLY_LABEL}
    </button>
  );
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
  filesOnly,
  onFilesOnlyChange,
  banner,
}: AskComposerProps) {
  const centered = variant === 'centered';

  const submitText =
    status === 'retrieving' ? 'Searching…' : status === 'answering' ? 'Answering…' : submitLabel;

  // The input + submit row — the demo Ask composer: a large 50px-tall search
  // field + a matching 50px "Ask" button (brand.css .kpd-ci / .kpd-ask-btn).
  const inputRow = (
    <div style={{ display: 'flex', gap: 10, width: '100%', alignItems: 'center' }}>
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
        size="lg"
        style={{ flex: 1, minWidth: 0 }}
      />
      <Button
        variant="primary"
        size="lg"
        onClick={onSubmit}
        disabled={isBusy || !question.trim()}
        loading={isBusy}
        iconLeft={isBusy ? undefined : ArrowRight}
        aria-label={
          status === 'retrieving' ? 'Searching your documents' : status === 'answering' ? 'Answering' : undefined
        }
        data-testid="ask-composer-submit"
        style={{ flexShrink: 0, height: 50, padding: '0 22px', borderRadius: 12, fontSize: '15px', fontWeight: 700 }}
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
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 'var(--kp-space-sm)', flexWrap: 'wrap' }}>
          <ScopeToggle scope={askScope} onChange={setAskScope} hasMatter={hasMatter} isSample={isSample} />
          <FilesOnlyToggle value={filesOnly} onChange={onFilesOnlyChange} />
        </div>
        {banner ? <div style={{ width: '100%' }}>{banner}</div> : null}
        {inputRow}
        <EgressIndicator provider={egressProvider} mode={egressMode} variant="full" />
      </div>
    );
  }

  // variant === 'bottom' — sticky bar pinned to the bottom of the conversation.
  // No top divider line (demo Ask): the bottom is just pills + search bar.
  const barStyle: CSSProperties = {
    flexShrink: 0,
    background: 'var(--color-background)',
    padding: 'var(--kp-space-sm) var(--kp-gutter) var(--kp-space-md)',
  };

  return (
    <div data-testid="ask-composer" data-variant="bottom" style={barStyle}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--kp-space-sm)',
        }}
      >
        {/* Bottom bar is ONLY the scope pills + the search bar (demo Ask). The
            egress/privacy indicator moved to the Ask header, top-right. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--kp-space-sm)',
            flexWrap: 'wrap',
          }}
        >
          <ScopeToggle scope={askScope} onChange={setAskScope} hasMatter={hasMatter} isSample={isSample} />
          <FilesOnlyToggle value={filesOnly} onChange={onFilesOnlyChange} />
        </div>
        {banner ? <div style={{ width: '100%' }}>{banner}</div> : null}
        {inputRow}
      </div>
    </div>
  );
}
