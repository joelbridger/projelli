// Toolbar / AI-redline control components extracted from DocxEditor.tsx
// (behavior-preserving 3.0 reorg). The Reviewing (All Markup / No Markup)
// toggle, the AI redline instruction composer, and the redline results
// summary. Pure presentational; every input arrives via props.

import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Loader2, Sparkles, Wand2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { RedlineSummary } from './docxEditorHelpers';

export function ReviewingToggle({
  reviewing,
  onToggle,
}: {
  reviewing: boolean;
  onToggle: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-testid="docx-reviewing-toggle"
      role="switch"
      aria-checked={reviewing}
      onClick={() => { onToggle(!reviewing); }}
      title={t('media.docx-editor.reviewing-hint')}
      className={cn(
        'flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        reviewing
          ? 'border-[#0A2540]/30 bg-[#0A2540]/5 text-[#0A2540]'
          : 'border-border bg-background text-muted-foreground hover:text-foreground',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative h-3.5 w-6 rounded-full transition-colors',
          reviewing ? 'bg-[#0A2540]' : 'bg-muted-foreground/30',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all',
            reviewing ? 'left-[12px]' : 'left-0.5',
          )}
        />
      </span>
      {t('media.docx-editor.reviewing')}
    </button>
  );
}

// ===========================================================================
// A4: AI redline composer + results summary
// ===========================================================================

/**
 * The instruction composer. A textarea + "Suggest changes" button. Cmd/Ctrl+Enter
 * submits. Shows a key-required hint when no provider key is configured, and any
 * provider error inline.
 */
export function RedlineComposer({
  instruction,
  onInstructionChange,
  busy,
  error,
  hasKey,
  aiPaused,
  onRun,
  onClose,
}: {
  instruction: string;
  onInstructionChange: (v: string) => void;
  busy: boolean;
  error: string | null;
  hasKey: boolean;
  /** True when AI features are paused (lapsed subscription / expired trial). */
  aiPaused: boolean;
  onRun: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="docx-redline-composer"
      className="border-b bg-[#0A2540]/[0.03] px-3 py-2.5"
    >
      <div className="mx-auto flex max-w-[816px] flex-col gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0A2540]">
          <Sparkles className="h-3.5 w-3.5" />
          {t('media.docx-editor.revise-with-ai')}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={t('media.docx-editor.redline-close')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <Textarea
          data-testid="docx-redline-input"
          value={instruction}
          onChange={(e) => { onInstructionChange(e.target.value); }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              if (!aiPaused) onRun();
            }
          }}
          placeholder={t('media.docx-editor.redline-placeholder')}
          disabled={busy || aiPaused}
          className="min-h-[60px] resize-y bg-background text-sm"
        />
        {aiPaused && (
          <p
            data-testid="docx-redline-ai-paused"
            className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
          >
            {t('media.docx-editor.redline-ai-paused')}
          </p>
        )}
        {!aiPaused && !hasKey && (
          <p
            data-testid="docx-redline-need-key"
            className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
          >
            {t('media.docx-editor.redline-need-key')}
          </p>
        )}
        {error && (
          <p
            data-testid="docx-redline-error"
            className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700"
          >
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-[10px] text-muted-foreground">
            {t('media.docx-editor.redline-egress-note')}
          </span>
          <Button
            data-testid="docx-redline-submit"
            size="sm"
            className="h-7 gap-1.5 bg-[#0A2540] text-xs hover:bg-[#0A2540]/90"
            onClick={onRun}
            disabled={busy || instruction.trim().length === 0 || !hasKey || aiPaused}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" />
            )}
            {busy
              ? t('media.docx-editor.redline-working')
              : t('media.docx-editor.redline-submit')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * A compact summary of the last redline: a headline (N changes proposed) and a
 * list of the AI's reasons, marking any edit whose anchor couldn't be located.
 */
export function RedlineSummaryPanel({
  summary,
  onDismiss,
}: {
  summary: RedlineSummary;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const total = summary.applied + summary.skipped;
  return (
    <div
      data-testid="docx-redline-summary"
      className="border-b bg-emerald-50/60 px-3 py-2"
    >
      <div className="mx-auto max-w-[816px]">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-900">
          <Sparkles className="h-3.5 w-3.5" />
          {total === 0
            ? t('media.docx-editor.redline-no-changes')
            : t('media.docx-editor.redline-summary-headline', {
                applied: summary.applied,
              })}
          {summary.skipped > 0 && (
            <span className="font-normal text-amber-700">
              {t('media.docx-editor.redline-skipped', { skipped: summary.skipped })}
            </span>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={t('media.docx-editor.redline-dismiss')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {summary.items.length > 0 && (
          <ul
            data-testid="docx-redline-reasons"
            className="mt-1.5 space-y-1 text-[11px]"
          >
            {summary.items.map((item, i) => (
              <li
                key={i}
                data-applied={item.applied ? 'true' : 'false'}
                className="flex items-start gap-1.5"
              >
                {item.applied ? (
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                )}
                <span
                  className={cn(
                    'flex-1',
                    item.applied ? 'text-foreground/80' : 'text-amber-800',
                  )}
                >
                  {item.reason || t(`media.docx-editor.redline-op-${item.op}`)}
                  {!item.applied && item.error && (
                    <span className="ml-1 text-amber-600">({item.error})</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
