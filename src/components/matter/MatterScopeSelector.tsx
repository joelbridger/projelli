/**
 * MatterScopeSelector (WS-B/C app) — the always-visible active-matter
 * indicator + switcher shown in the AI chat header.
 *
 * It tells the user, at a glance, which matter the next question will be
 * scoped to (so other clients' data can never appear), and lets them switch
 * the active matter or deliberately drop to the cross-matter ("All matters")
 * scope. Switching here changes retrieval scope for every chat.
 *
 * Design: light theme, navy (primary) accent for the active-matter state, an
 * amber accent for the explicit all-matters state so the cross-matter mode is
 * never mistaken for normal single-client work.
 */

import { useTranslation } from 'react-i18next';
import { Briefcase, ChevronDown, Check, Globe, Settings2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useMatters, useActiveMatterId, useMatterStore } from '@/stores/matterStore';
import { matterLabel } from '@/modules/memory/matterResolver';

export interface MatterScopeSelectorProps {
  /** Opens the matter manager dialog so the user can create/map matters. */
  onManageMatters?: () => void;
  className?: string;
}

export function MatterScopeSelector({
  onManageMatters,
  className,
}: MatterScopeSelectorProps) {
  const { t } = useTranslation();
  const matters = useMatters();
  const activeMatterId = useActiveMatterId();
  const setActiveMatter = useMatterStore((s) => s.setActiveMatter);

  const active = matters.find((m) => m.id === activeMatterId) ?? null;
  const isAllMatters = active === null;

  const triggerLabel = active
    ? matterLabel(active)
    : t('matter.scope.all-matters');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="matter-scope-selector"
          data-scope={isAllMatters ? 'allMatters' : 'matter'}
          data-matter-id={active?.id ?? ''}
          title={
            isAllMatters
              ? t('matter.scope.all-matters-title')
              : t('matter.scope.active-title', { name: triggerLabel })
          }
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium max-w-[260px]',
            isAllMatters
              ? 'border-amber-400/60 bg-amber-50 text-amber-900'
              : 'border-primary/40 bg-primary/10 text-primary',
            className,
          )}
        >
          {isAllMatters ? (
            <Globe className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Briefcase className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs">
          {t('matter.scope.menu-label')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {matters.length === 0 ? (
          <div
            data-testid="matter-scope-empty"
            className="px-2 py-3 text-xs text-muted-foreground"
          >
            {t('matter.scope.no-matters')}
          </div>
        ) : (
          matters.map((m) => {
            const isActive = m.id === activeMatterId;
            return (
              <DropdownMenuItem
                key={m.id}
                data-testid={`matter-scope-option-${m.id}`}
                onClick={() => {
                  setActiveMatter(m.id);
                }}
                className="flex items-start gap-2 text-xs"
              >
                <Briefcase className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="flex-1 min-w-0">
                  <span className="block truncate font-medium">{m.name || m.id}</span>
                  {m.client && (
                    <span className="block truncate text-muted-foreground">
                      {m.client}
                    </span>
                  )}
                </span>
                {isActive && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        {/* Explicit cross-matter capability, clearly the odd one out. */}
        <DropdownMenuItem
          data-testid="matter-scope-option-all"
          onClick={() => {
            setActiveMatter(null);
          }}
          className="flex items-center gap-2 text-xs"
        >
          <Globe className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span className="flex-1">{t('matter.scope.all-matters')}</span>
          {isAllMatters && <Check className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
        </DropdownMenuItem>
        {onManageMatters && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="matter-scope-manage"
              onClick={onManageMatters}
              className="flex items-center gap-2 text-xs"
            >
              <Settings2 className="h-3.5 w-3.5 shrink-0" />
              <span>{t('matter.scope.manage')}</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default MatterScopeSelector;
