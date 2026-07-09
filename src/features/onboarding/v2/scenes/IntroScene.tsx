/**
 * IntroScene — the hook. Logo, headline, a 3-node flowchart with Lottie
 * animations, three trust pills, and a "Go!" button that advances.
 *
 * Maps to prototype scene 1 ("intro").
 */

import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LottiePlayer } from '../LottiePlayer';
import { SecurityPill } from '../components/SecurityPill';
import { getOnboardingV2Copy } from '../copy';
import { AppLogo } from '@/ui/brand/AppLogo';

const FLOW_LOTTIES = [
  '/onboarding/lottie/step1.json',
  '/onboarding/lottie/step2.json',
  '/onboarding/lottie/step3.json',
] as const;

export interface IntroSceneProps {
  onGo: () => void;
}

export function IntroScene({ onGo }: IntroSceneProps) {
  const { t } = useTranslation();
  const { intro } = getOnboardingV2Copy(t);
  return (
    <div className="flex w-full flex-col items-center" data-testid="onboarding-v2-intro">
      <AppLogo height={32} className="kp-onbv2-rise mb-12" />

      <h1 className="kp-onbv2-rise max-w-[20ch] text-4xl font-extrabold leading-[1.12] tracking-[-0.015em] text-[var(--kp-navy)] md:text-5xl">
        {intro.headline}
      </h1>

      {/* 3-node flowchart */}
      <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
        {intro.flow.map((item, i) => (
          <div key={item.title} className="flex items-center gap-4">
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
                {item.title}
              </div>
              <div className="mt-2 min-h-[2.5rem] text-center text-xs leading-snug text-[#5b6b80]">
                {item.body}
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
        <div className="kp-onbv2-rise" style={{ animationDelay: '0.5s' }}>
          <SecurityPill icon={ShieldCheck} label={intro.trustLine} />
        </div>
      </div>

      <p className="kp-onbv2-rise mt-4 text-xs font-medium text-[#6f7b8f]" style={{ animationDelay: '0.7s' }}>
        {intro.helpLine}
      </p>

      {/* Go */}
      <button
        type="button"
        onClick={onGo}
        data-testid="onboarding-v2-go"
        className="kp-onbv2-rise mt-12 rounded-full bg-[var(--kp-accent)] px-11 py-4 text-xl font-bold text-white shadow-[0_12px_30px_rgba(var(--kp-navy-rgb),0.22)] transition-transform active:translate-y-px"
        style={{ animationDelay: '0.9s' }}
      >
        {intro.cta}
      </button>
    </div>
  );
}
