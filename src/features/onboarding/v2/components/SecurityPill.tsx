/**
 * SecurityPill — a white rounded pill with a leading line icon, matching the
 * prototype's trust pills. Light theme, brand-accent icon.
 */

import type { LucideIcon } from 'lucide-react';

export interface SecurityPillProps {
  icon: LucideIcon;
  label: string;
  className?: string;
}

export function SecurityPill({ icon: Icon, label, className }: SecurityPillProps) {
  return (
    <span
      className={`inline-flex items-center gap-2.5 rounded-full border border-[rgba(var(--kp-navy-rgb),0.10)] bg-white/90 px-5 py-3 text-sm font-semibold text-[var(--kp-navy)] shadow-[0_8px_30px_rgba(var(--kp-navy-rgb),0.06)] ${className ?? ''}`}
      data-testid="onboarding-v2-security-pill"
    >
      <Icon className="h-[17px] w-[17px] shrink-0 text-[var(--kp-accent)]" strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}
