/**
 * PrivilegeIndicator (WS-PRIV) — a compact inline badge showing a source's
 * privilege status. Rendered in the file tree row and the editor / mail header
 * so the user can see at a glance that a source is privileged (and therefore
 * excluded from AI retrieval by default).
 *
 * Renders nothing for the `none` status (no badge for non-privileged content,
 * to avoid visual noise). Light theme: a restrained amber/rose treatment so a
 * privileged source reads as "handle with care" without shouting.
 */

import { ShieldAlert, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  isPrivileged,
  privilegeShortLabel,
  privilegeLabel,
  type Privilege,
} from '@/platform/types/privilege';

export interface PrivilegeIndicatorProps {
  privilege: Privilege;
  /** Compact mode (file-tree row): icon only, label as title. */
  compact?: boolean;
  className?: string;
}

export function PrivilegeIndicator({
  privilege,
  compact = false,
  className,
}: PrivilegeIndicatorProps) {
  if (!isPrivileged(privilege)) return null;

  const Icon = privilege === 'attorney-client' ? Lock : ShieldAlert;
  const full = privilegeLabel(privilege);

  return (
    <span
      data-testid="privilege-indicator"
      data-privilege={privilege}
      title={`${full} — excluded from AI retrieval by default`}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium leading-none',
        'border-rose-300 bg-rose-50 text-rose-700',
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {!compact && <span className="truncate">{privilegeShortLabel(privilege)}</span>}
    </span>
  );
}

export default PrivilegeIndicator;
