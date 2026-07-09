import { useState } from 'react';
import { Check, FileText, ShieldCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getOnboardingV2Copy } from '../copy';

export function ComplianceScene() {
  const { t } = useTranslation();
  const C = getOnboardingV2Copy(t);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex w-full flex-col items-center" data-testid="onboarding-v2-compliance">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--kp-accent)]/10 text-[var(--kp-accent)]">
        <ShieldCheck className="h-7 w-7" strokeWidth={2} aria-hidden="true" />
      </div>

      <h1 className="mt-6 max-w-[18ch] text-3xl font-extrabold tracking-[-0.01em] text-[var(--kp-navy)] md:text-4xl">
        {C.compliance.headline}
      </h1>
      <p className="mt-4 max-w-[58ch] text-base leading-relaxed text-[rgba(var(--kp-navy-rgb),0.72)]">
        {C.compliance.body}
      </p>

      <div className="mt-8 grid w-full max-w-[880px] grid-cols-1 gap-3 text-left">
        {C.compliance.points.map((point) => (
          <div
            key={point}
            className="flex items-start gap-3 rounded-lg border border-[var(--kp-divider)] bg-white px-5 py-4 shadow-[var(--kp-shadow-1)]"
          >
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kp-blue)]" strokeWidth={3} aria-hidden="true" />
            <span className="text-sm leading-relaxed text-[var(--kp-navy)]">{point}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        data-testid="onboarding-compliance-officer-cta"
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-[var(--kp-accent)] px-7 py-3 text-sm font-bold text-white shadow-[0_12px_30px_rgba(var(--kp-navy-rgb),0.18)] transition-transform active:translate-y-px"
      >
        <FileText className="h-4 w-4" aria-hidden="true" />
        {C.compliance.cta}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(var(--kp-navy-rgb),0.45)] p-6"
          onClick={() => {
            setOpen(false);
          }}
          data-testid="onboarding-compliance-security-modal"
        >
          <div
            className="relative max-w-[560px] rounded-[22px] bg-white p-8 text-left shadow-[0_30px_80px_rgba(var(--kp-navy-rgb),0.32)]"
            onClick={(e) => {
              e.stopPropagation();
            }}
            role="dialog"
            aria-modal="true"
            aria-label={C.compliance.modalTitle}
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
              }}
              aria-label={C.nav.close}
              className="absolute right-5 top-5 text-[#9aa4b4] hover:text-[var(--kp-navy)]"
            >
              <X className="h-6 w-6" />
            </button>
            <h2 className="text-2xl font-extrabold text-[var(--kp-navy)]">{C.compliance.modalTitle}</h2>
            <p className="mt-3 text-base leading-relaxed text-[rgba(var(--kp-navy-rgb),0.80)]">
              {C.compliance.modalBody}
            </p>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
              }}
              className="mt-6 rounded-full bg-[var(--kp-accent)] px-7 py-2.5 text-sm font-bold text-white"
            >
              {C.compliance.modalCta}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
