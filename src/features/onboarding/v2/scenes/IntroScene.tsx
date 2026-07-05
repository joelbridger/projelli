/**
 * IntroScene — the hook. Logo, headline, a 3-node flowchart with Lottie
 * animations, three trust pills, and a "Go!" button that advances.
 *
 * Maps to prototype scene 1 ("intro").
 */

import { WifiOff, Lock, Award } from 'lucide-react';
import { LottiePlayer } from '../LottiePlayer';
import { SecurityPill } from '../components/SecurityPill';
import { ONB_COPY } from '../copy';

const PILL_ICONS = [WifiOff, Lock, Award] as const;
const FLOW_LOTTIES = [
  '/onboarding/lottie/step1.json',
  '/onboarding/lottie/step2.json',
  '/onboarding/lottie/step3.json',
] as const;

export interface IntroSceneProps {
  onGo: () => void;
}

export function IntroScene({ onGo }: IntroSceneProps) {
  const { intro } = ONB_COPY;
  return (
    <div className="flex w-full flex-col items-center" data-testid="onboarding-v2-intro">
      <img src="/onboarding/app-logo.svg" alt="Advisor Prep Hero" className="kp-onbv2-rise mb-12 h-8" />

      <h1 className="kp-onbv2-rise max-w-[20ch] text-4xl font-extrabold leading-[1.12] tracking-[-0.015em] text-[var(--kp-navy)] md:text-5xl">
        {intro.headline}
      </h1>

      {/* 3-node flowchart */}
      <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
        {intro.flow.map((title, i) => (
          <div key={title} className="flex items-center gap-4">
            <div
              className="kp-onbv2-rise flex w-[230px] flex-col items-center rounded-[18px] border border-[rgba(var(--kp-navy-rgb),0.08)] bg-white/85 px-6 py-6 shadow-[0_10px_40px_rgba(var(--kp-navy-rgb),0.06)]"
              style={{ animationDelay: `${(0.15 + i * 0.12).toFixed(2)}s` }}
            >
              <LottiePlayer
                src={FLOW_LOTTIES[i] ?? FLOW_LOTTIES[0]}
                size={130}
                testId={`intro-flow-icon-${String(i)}`}
              />
              <div
                className="mt-3 text-base font-bold leading-snug text-[var(--kp-navy)]"
                data-testid={`intro-flow-heading-${String(i)}`}
              >
                {title}
              </div>
            </div>
            {i < intro.flow.length - 1 ? (
              <span className="text-4xl font-light text-[var(--kp-accent)] md:text-5xl" aria-hidden="true">
                &rarr;
              </span>
            ) : null}
          </div>
        ))}
      </div>

      {/* Trust pills */}
      <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
        {intro.pills.map((label, i) => (
          <div key={label} className="kp-onbv2-rise" style={{ animationDelay: `${(0.5 + i * 0.09).toFixed(2)}s` }}>
            <SecurityPill icon={PILL_ICONS[i] ?? WifiOff} label={label} />
          </div>
        ))}
      </div>

      {/* Go */}
      <button
        type="button"
        onClick={onGo}
        data-testid="onboarding-v2-go"
        className="kp-onbv2-rise mt-12 rounded-full bg-[var(--kp-accent)] px-11 py-4 text-xl font-bold text-white shadow-[0_12px_30px_rgba(var(--kp-navy-rgb),0.22)] transition-transform active:translate-y-px"
        style={{ animationDelay: '0.85s' }}
      >
        {intro.cta}
      </button>
    </div>
  );
}
