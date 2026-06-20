/**
 * Ch5LocalSetup — guided local-AI setup for the onboarding journey.
 *
 * Extracted from Ch5ChooseYourBrain's minimal LocalView as part of Task 4.
 * This component owns the full state machine for getting Ollama installed and
 * a model downloaded with NO terminal instructions shown to the user.
 *
 * State machine:
 *   checking       — detecting on mount
 *   needs-install  — Ollama not found; "Set it up for me" opens download page
 *   waiting        — polling while installer runs (after openExternal)
 *   downloading    — pulling the default model with a progress bar
 *   ready          — Ollama + model present; "Use local AI" advances
 *   error          — any failure; "Try again" re-detects; "Open Ollama" reopens page
 *
 * Uses an AbortController so navigating away cancels in-flight operations.
 */

/* eslint-disable keepance-i18n/no-hardcoded-string */

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, RefreshCw } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';

import type { ChapterContext } from '../engine/types';
import { JOURNEY_STRINGS } from '../copy/strings';
import { detectOllama } from '@/platform/providers/OllamaProvider';
import { openExternal } from '@/platform/utils/openExternal';
import { clearAiSetupDeferred } from '@/features/onboarding/aiSetupState';
import {
  waitForOllama,
  pullOllamaModel,
  OLLAMA_DEFAULT_MODEL,
} from './ollamaSetup';

const S = JOURNEY_STRINGS.ch5.local;

/** URL for the Ollama installer — matches the URL already used by AiSetupStep. */
const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';

// ---------------------------------------------------------------------------
// State machine types
// ---------------------------------------------------------------------------

type SetupPhase =
  | { kind: 'checking' }
  | { kind: 'needs-install' }
  | { kind: 'waiting' }
  | { kind: 'downloading'; percent: number; status: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface Ch5LocalSetupProps {
  ctx: ChapterContext;
  onBack: () => void;
  /** Called when setup completes — parent should call ctx.setData then advance. */
  onReady: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Ch5LocalSetup({ ctx, onBack, onReady }: Ch5LocalSetupProps) {
  const [phase, setPhase] = useState<SetupPhase>({ kind: 'checking' });
  // AbortController ref so any in-flight poll/pull is cancelled on unmount or retry.
  const abortRef = useRef<AbortController | null>(null);

  /** Cancel any running operation and create a fresh controller. */
  function freshAbort(): AbortController {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    return ctrl;
  }

  /** Check Ollama once and update phase based on the result. */
  async function detect(ctrl: AbortController) {
    try {
      const result = await detectOllama();
      if (ctrl.signal.aborted) return;

      if (result.reachable && result.models.length > 0) {
        setPhase({ kind: 'ready' });
      } else if (result.reachable && result.models.length === 0) {
        // Reachable but no model — jump straight to download.
        await startDownload(ctrl);
      } else {
        setPhase({ kind: 'needs-install' });
      }
    } catch {
      if (ctrl.signal.aborted) return;
      setPhase({ kind: 'needs-install' });
    }
  }

  /** Pull the default model, updating progress state as bytes arrive. */
  async function startDownload(ctrl: AbortController) {
    setPhase({ kind: 'downloading', percent: 0, status: '' });
    try {
      await pullOllamaModel(OLLAMA_DEFAULT_MODEL, {
        signal: ctrl.signal,
        onProgress: ({ percent, status }) => {
          if (ctrl.signal.aborted) return;
          setPhase({ kind: 'downloading', percent, status });
        },
      });
      if (ctrl.signal.aborted) return;
      setPhase({ kind: 'ready' });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Something went wrong during the download.';
      setPhase({ kind: 'error', message });
    }
  }

  /** Poll until Ollama becomes reachable after the installer finishes. */
  async function startWaiting(ctrl: AbortController) {
    setPhase({ kind: 'waiting' });
    try {
      const outcome = await waitForOllama({ signal: ctrl.signal });
      if (ctrl.signal.aborted) return;

      if (outcome === 'ready') {
        setPhase({ kind: 'ready' });
      } else if (outcome === 'no-model') {
        await startDownload(ctrl);
      } else {
        // 'unreachable' — timed out
        setPhase({ kind: 'error', message: 'Ollama did not start in time. Try opening it manually and click Try again.' });
      }
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Something went wrong while waiting.';
      setPhase({ kind: 'error', message });
    }
  }

  // On mount: run an initial detect.
  useEffect(() => {
    const ctrl = freshAbort();
    void detect(ctrl);
    return () => { ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  function handleSetItUp() {
    void openExternal(OLLAMA_DOWNLOAD_URL).catch(() => { /* ignore popup-blocked */ });
    const ctrl = freshAbort();
    void startWaiting(ctrl);
  }

  function handleTryAgain() {
    const ctrl = freshAbort();
    setPhase({ kind: 'checking' });
    void detect(ctrl);
  }

  function handleOpenOllama() {
    void openExternal(OLLAMA_DOWNLOAD_URL).catch(() => { /* ignore popup-blocked */ });
  }

  function handleUseLocal() {
    ctx.actions.setConfidentialityMode('local-only');
    clearAiSetupDeferred();
    onReady();
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-5" data-testid="ch5-local-view">
      {/* Header */}
      <div>
        <h2
          className="text-3xl font-bold tracking-tight"
          style={{ color: 'var(--kp-navy)' }}
          data-testid="ch5-local-title"
        >
          {phase.kind === 'needs-install'
            ? S.needsInstall.title
            : phase.kind === 'downloading'
              ? S.downloading.title
              : S.title}
        </h2>
        {(phase.kind === 'checking' || phase.kind === 'ready' || phase.kind === 'waiting') && (
          <p className="text-base text-muted-foreground mt-1">{S.sub}</p>
        )}
        {phase.kind === 'needs-install' && (
          <p className="text-base text-muted-foreground mt-1">{S.needsInstall.body}</p>
        )}
      </div>

      {/* Status panel */}
      <div
        className="rounded-lg border border-border p-4"
        data-testid="ch5-local-status"
      >
        {phase.kind === 'checking' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="ch5-local-checking">
            <RefreshCw className={cn('h-4 w-4', !ctx.reducedMotion && 'animate-spin')} aria-hidden />
            {S.checking.msg}
          </p>
        )}

        {phase.kind === 'needs-install' && (
          <p className="text-sm text-muted-foreground" data-testid="ch5-local-needs-install">
            Click "Set it up for me" and we'll walk you through the rest.
          </p>
        )}

        {phase.kind === 'waiting' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="ch5-local-waiting">
            <RefreshCw className={cn('h-4 w-4', !ctx.reducedMotion && 'animate-spin')} aria-hidden />
            {S.waiting.msg}
          </p>
        )}

        {phase.kind === 'downloading' && (
          <div className="space-y-3" data-testid="ch5-local-downloading">
            <p className="text-sm text-muted-foreground">{S.downloading.title}</p>
            {/* Progress bar */}
            <div
              className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={phase.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Download progress"
              data-testid="ch5-local-progress-bar"
            >
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${String(phase.percent)}%` }}
                data-testid="ch5-local-progress-fill"
              />
            </div>
            <p className="text-xs text-muted-foreground" data-testid="ch5-local-percent">
              {phase.percent}{S.downloading.percentSuffix}
            </p>
          </div>
        )}

        {phase.kind === 'ready' && (
          <div className="space-y-1" data-testid="ch5-local-ready">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <Check className="h-4 w-4" aria-hidden />
              {S.ready.msg}
            </p>
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="space-y-3" data-testid="ch5-local-error">
            <p className="text-sm font-medium text-foreground">
              {S.error.msg}
            </p>
            {phase.message && phase.message !== S.error.msg && (
              <p className="text-xs text-muted-foreground">{phase.message}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleTryAgain}
                data-testid="ch5-local-retry-btn"
              >
                {S.error.retryBtn}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleOpenOllama}
                data-testid="ch5-local-open-btn"
              >
                {S.error.openBtn}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="flex items-center justify-between gap-2 pt-4 border-t border-border">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={phase.kind === 'downloading' || phase.kind === 'waiting'}
          className="gap-1.5"
          data-testid="ch5-local-back-btn"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {S.backBtn}
        </Button>

        {/* Primary action varies by phase */}
        {phase.kind === 'needs-install' && (
          <Button
            size="lg"
            onClick={handleSetItUp}
            data-testid="ch5-local-setup-btn"
          >
            {S.needsInstall.btn}
          </Button>
        )}

        {phase.kind === 'ready' && (
          <Button
            size="lg"
            onClick={handleUseLocal}
            data-testid="ch5-use-local-btn"
          >
            {S.ready.btn}
          </Button>
        )}

        {/* No primary button during checking / waiting / downloading / error */}
      </div>
    </div>
  );
}
