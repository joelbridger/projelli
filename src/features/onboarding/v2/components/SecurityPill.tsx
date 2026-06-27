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
      className={`inline-flex items-center gap-2.5 rounded-full border border-[#0a2540]/10 bg-white/90 px-5 py-3 text-sm font-semibold text-[#0a2540] shadow-[0_8px_30px_rgba(10,37,64,0.06)] ${className ?? ''}`}
      data-testid="onboarding-v2-security-pill"
    >
      <Icon className="h-[17px] w-[17px] shrink-0 text-[#1f74c4]" strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}
