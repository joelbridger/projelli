/**
 * ChooseStartScene — "Pick how you want to start".
 *
 * This is the workspace-first step: connectors, email/Wealthbox import, and the
 * Client Map all need a workspace to exist, so the user establishes one HERE,
 * before the AI / Connect / Firm-setup steps that depend on it.
 *
 * Two honest paths:
 *   - "Start with a sample practice" (default, recommended): opens/creates a
 *     workspace and seeds the Hendricks Household sample + a fully-cited Client
 *     Map, so the advisor lands in a populated, working app in minute one.
 *   - "Connect my own data": opens/creates an empty workspace; the next steps
 *     import the advisor's real email / files / CRM into it.
 *
 * Both call `onChooseStart(mode)`, which (in the live app) drives the same
 * tested folder-pick + create flow the Workspace Selector uses, then — for the
 * sample — writes the sample files and seeds the Client Map. The scene only
 * advances on success; a cancelled folder dialog leaves the user here, and a
 * real error is surfaced inline. When no handler is wired (tests / browser
 * preview) the buttons advance immediately so the flow stays navigable.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, FolderPlus, Sparkles, Loader2 } from 'lucide-react';

import type { OnboardingStartMode, OnboardingStartResult } from '../../onboardingTypes';
import { InfoHelp } from '@/ui/InfoHelp';
import { getOnboardingV2Copy } from '../copy';

export interface ChooseStartSceneProps {
  /** Establish the workspace (and seed the sample for 'sample'); resolves with
   *  the outcome so we only advance on success. Optional for tests/preview. */
  onChooseStart?: ((mode: OnboardingStartMode) => Promise<OnboardingStartResult>) | undefined;
  /** Advance to the next scene once a workspace is ready. */
  onReady: () => void;
}

export function ChooseStartScene({ onChooseStart, onReady }: ChooseStartSceneProps) {
  const { t } = useTranslation();
  const C = getOnboardingV2Copy(t).choose;
  const [busy, setBusy] = useState<OnboardingStartMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(mode: OnboardingStartMode) {
    if (busy) return;
    setError(null);
    if (!onChooseStart) {
      // No live handler (unit/browser preview): treat as success so the flow
      // stays navigable.
      onReady();
      return;
    }
    setBusy(mode);
    try {
      const result = await onChooseStart(mode);
      if (result.ok) {
        onReady();
      } else if (result.cancelled) {
        // User backed out of the folder picker — stay put, no error.
        setError(null);
      } else {
        setError(result.error ?? C.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : C.error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex w-full flex-col items-center" data-testid="onboarding-v2-choose-start">
      <h1 className="inline-flex items-center gap-2 text-3xl font-extrabold tracking-[-0.01em] text-[var(--kp-navy)] md:text-4xl">
        {C.headline}
        <InfoHelp content={C.help} />
      </h1>

      <div className="mt-10 grid w-full max-w-[920px] grid-cols-1 gap-6 text-left md:grid-cols-2">
        {/* ---- Sample practice (recommended / default) ---- */}
        <button
          type="button"
          onClick={() => void pick('sample')}
          disabled={busy !== null}
          data-testid="choose-start-sample"
          className="group relative flex flex-col rounded-[22px] border-2 border-[var(--kp-accent)] bg-white p-7 text-left transition-shadow hover:shadow-[0_18px_50px_rgba(var(--kp-navy-rgb),0.12)] disabled:opacity-60"
        >
          <span className="absolute right-5 top-5 rounded-full bg-[var(--kp-accent)] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white">
            {C.sample.badge}
          </span>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--kp-accent)]/10">
            <Sparkles className="h-5 w-5 text-[var(--kp-accent)]" strokeWidth={2} aria-hidden="true" />
          </div>
          <h2 className="inline-flex items-center gap-1.5 mt-4 text-xl font-bold text-[var(--kp-navy)]">
            {C.sample.title}
            <InfoHelp
              as="span"
              content={C.sample.help}
            />
          </h2>
          <ul className="mt-4 space-y-2">
            {C.sample.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm text-[var(--kp-navy)]">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kp-blue)]" strokeWidth={3} aria-hidden="true" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
          <span className="mt-6 inline-flex items-center gap-2 self-start rounded-xl bg-[var(--kp-accent)] px-6 py-3 text-sm font-bold text-white">
            {busy === 'sample' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {C.sample.loading}
              </>
            ) : (
              C.sample.cta
            )}
          </span>
        </button>

        {/* ---- Connect my own data ---- */}
        <button
          type="button"
          onClick={() => void pick('own')}
          disabled={busy !== null}
          data-testid="choose-start-own"
          className="group relative flex flex-col rounded-[22px] border-2 border-[rgba(var(--kp-navy-rgb),0.10)] bg-white p-7 text-left transition-shadow hover:shadow-[0_18px_50px_rgba(var(--kp-navy-rgb),0.10)] disabled:opacity-60"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(var(--kp-navy-rgb),0.06)]">
            <FolderPlus className="h-5 w-5 text-[var(--kp-navy)]" strokeWidth={2} aria-hidden="true" />
          </div>
          <h2 className="inline-flex items-center gap-1.5 mt-4 text-xl font-bold text-[var(--kp-navy)]">
            {C.own.title}
            <InfoHelp
              as="span"
              content={C.own.help}
            />
          </h2>
          <ul className="mt-4 space-y-2">
            {C.own.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm text-[var(--kp-navy)]">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kp-blue)]" strokeWidth={3} aria-hidden="true" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
          <span className="mt-6 inline-flex items-center gap-2 self-start rounded-xl border border-[var(--kp-accent)] px-6 py-3 text-sm font-bold text-[var(--kp-accent)]">
            {busy === 'own' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {C.own.loading}
              </>
            ) : (
              C.own.cta
            )}
          </span>
        </button>
      </div>

      {error ? (
        <div className="mt-5 max-w-[640px] rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600" role="alert" data-testid="choose-start-error">
          {error}
        </div>
      ) : null}
    </div>
  );
}
