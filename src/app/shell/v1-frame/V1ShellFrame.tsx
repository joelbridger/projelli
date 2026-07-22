import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Command, Search } from 'lucide-react';
import type { AppSurface } from '@/platform/types/navigation';
import {
  getBlessedAppRailLabel,
  getOrderedAppSurfaces,
} from '@/app/shell/registry/appSurfaceRegistry';
import { SharedClientBar } from '@/app/shell/SharedClientBar';
import { useAppSurfaceRegistry } from '@/app/shell/runtime/useAppSurfaceRegistry';
import { BRAND } from '@/config/brand';
import { EV_OPEN_ACCOUNT, EV_OPEN_SETTINGS } from '@/config/identity';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { useFlag } from '@/platform/flags';
import { useProfileStore } from '@/platform/profile/profileStore';
import { useFirmStore } from '@/platform/firm/firmStore';
import {
  NotificationBellSlot,
  type NotificationBellSlotDescriptor,
} from './NotificationBellSlot';

export interface V1ShellFrameProps {
  activeSurface: AppSurface;
  onSurfaceChange: (surface: AppSurface) => void;
  onOpenCommandPalette: () => void;
  sidebarCollapsed?: boolean;
  onSidebarCollapsedChange?: (collapsed: boolean) => void;
  globalStatus?: ReactNode;
  preTopbar?: ReactNode;
  postTopbar?: ReactNode;
  notificationBellSlot?: NotificationBellSlotDescriptor;
  children: ReactNode;
}

interface V1ShellFrameFlagGateProps extends V1ShellFrameProps {
  legacy: ReactNode;
}

/** Keeps the feature-flag read out of the legacy app shell. */
export function V1ShellFrameFlagGate({
  legacy,
  ...frameProps
}: V1ShellFrameFlagGateProps) {
  return useFlag('v1-shell-frame') ? <V1ShellFrame {...frameProps} /> : legacy;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}

function RegistryNavItems({
  activeSurface,
  onSurfaceChange,
  placement,
  descriptors,
}: Pick<V1ShellFrameProps, 'activeSurface' | 'onSurfaceChange'> & {
  placement: 'primary' | 'utility';
  descriptors: ReturnType<typeof useAppSurfaceRegistry>['descriptors'];
}) {
  const { t } = useTranslation();
  const surfaces = getOrderedAppSurfaces(placement, descriptors).filter(
    (surface) =>
      placement === 'primary'
        ? getBlessedAppRailLabel(surface.id) !== undefined
        : surface.id === 'settings'
  );

  return (
    <div
      className="flex flex-col gap-1"
      data-testid={`v1-shell-${placement}-nav`}
    >
      {surfaces.map((surface) => {
        const Icon = surface.icon;
        const active = surface.id === activeSurface;
        const label = getBlessedAppRailLabel(surface.id) ?? t(surface.labelKey);
        return (
          <button
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'flex min-h-10 items-center gap-3 rounded-lg bg-slate-900 px-3 text-left text-sm font-semibold text-white shadow-sm'
                : 'flex min-h-10 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950'
            }
            data-testid={`v1-shell-nav-${surface.id}`}
            key={surface.id}
            onClick={() => {
              onSurfaceChange(surface.id);
            }}
            type="button"
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function FirmCard({
  onOpenSettings,
}: {
  onOpenSettings: (category: 'workspace' | 'organization') => void;
}) {
  const { t } = useTranslation();
  const firmName = useProfileStore((state) => state.firmName);
  const firm = useFirmStore((state) => state.session);

  const workspaceName =
    firmName.trim() ||
    firm?.org?.name ||
    t('shell-frame.firm-card.default-name');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Open ${workspaceName} workspace menu`}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left shadow-sm transition-colors hover:bg-white"
          data-testid="v1-shell-firm-card"
          type="button"
        >
          <strong className="block truncate text-sm font-semibold text-slate-950">
            {workspaceName}
          </strong>
          {firm ? (
            <span className="mt-1 block text-xs text-slate-500">
              {t('shell-frame.firm-card.summary', { count: firm.seats })}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{workspaceName}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="v1-shell-workspace-settings"
          onSelect={() => {
            onOpenSettings('workspace');
          }}
        >
          {t('settings-v1.workspace.settings-menu')}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="v1-shell-workspace-organization"
          onSelect={() => {
            onOpenSettings('organization');
          }}
        >
          {t('settings-v1.workspace.organization-menu')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserAvatar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation();
  const soloName = useProfileStore((state) => state.soloName);
  const soloAvatar = useProfileStore((state) => state.soloAvatar);
  const label = soloName.trim() || t('shell-frame.avatar.fallback-name');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t('shell-frame.avatar.label', { name: label })}
          className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-900 text-xs font-bold text-white transition-opacity hover:opacity-85 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
          data-testid="v1-shell-account-identity"
          type="button"
        >
          {soloAvatar ? (
            <img alt="" className="size-full object-cover" src={soloAvatar} />
          ) : (
            initials(label) || 'A'
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="v1-shell-avatar-account"
          onSelect={() => {
            window.dispatchEvent(new CustomEvent(EV_OPEN_ACCOUNT));
          }}
        >
          {t('settings-v1.personal.account-menu')}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="v1-shell-avatar-personal-settings"
          onSelect={onOpenSettings}
        >
          {t('settings-v1.personal.settings-menu')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The permanent v1 app chrome. Navigation always comes from the app-surface
 * registry so later surface lanes add one descriptor rather than another rail
 * list. The shared-client lane owns the bar itself; this frame only owns its
 * conditional row in the grid.
 */
export function V1ShellFrame({
  activeSurface,
  onSurfaceChange,
  onOpenCommandPalette,
  sidebarCollapsed = false,
  onSidebarCollapsedChange = () => {},
  globalStatus,
  preTopbar,
  postTopbar,
  notificationBellSlot,
  children,
}: V1ShellFrameProps) {
  const { t } = useTranslation();
  const { descriptors } = useAppSurfaceRegistry();
  const activeDescriptor = descriptors.find(
    (descriptor) => descriptor.id === activeSurface
  );
  const schedulingDescriptor = descriptors.find(
    (descriptor) => descriptor.id === 'scheduling'
  );
  const SchedulingIcon = schedulingDescriptor?.icon;
  const hasSharedClientContext = activeDescriptor?.clientContext === 'shared';

  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden bg-slate-50 text-slate-950"
      data-testid="v1-shell-frame"
    >
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow-md focus:outline-none focus:ring-2 focus:ring-slate-900"
        href="#main-content"
      >
        {t('shell-frame.skip-to-content')}
      </a>
      <aside
        aria-label={t('shell-frame.nav.label')}
        className={`flex shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white py-4 transition-[width] ${sidebarCollapsed ? 'w-16 px-2' : 'w-60 px-3'}`}
        data-testid="v1-shell-global-nav"
      >
        <button
          className="mb-7 flex items-center gap-2 px-2"
          onClick={() => {
            onSidebarCollapsedChange(!sidebarCollapsed);
          }}
          type="button"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
            {BRAND.nameShort.slice(0, 1)}
          </span>
          <span
            className={
              sidebarCollapsed
                ? 'sr-only'
                : 'truncate text-sm font-bold tracking-tight text-slate-950'
            }
          >
            {BRAND.nameShort}
          </span>
        </button>
        <p
          className={
            sidebarCollapsed
              ? 'sr-only'
              : 'mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400'
          }
        >
          {t('shell-frame.nav.workspace')}
        </p>
        <RegistryNavItems
          activeSurface={activeSurface}
          onSurfaceChange={onSurfaceChange}
          placement="primary"
          descriptors={descriptors}
        />
        <div className="mt-auto space-y-3">
          <RegistryNavItems
            activeSurface={activeSurface}
            onSurfaceChange={onSurfaceChange}
            placement="utility"
            descriptors={descriptors}
          />
          {sidebarCollapsed ? null : (
            <FirmCard
              onOpenSettings={(category) => {
                window.dispatchEvent(
                  new CustomEvent(EV_OPEN_SETTINGS, { detail: { category } })
                );
                onSurfaceChange('settings');
              }}
            />
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {preTopbar}
        <header
          className="flex h-14 min-w-0 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5"
          data-testid="v1-shell-topbar"
        >
          <nav
            aria-label={t('shell-frame.breadcrumb.label')}
            className="min-w-0 shrink-0 text-sm"
          >
            <span className="text-slate-400">
              {t('shell-frame.breadcrumb.workspace')}
            </span>
            <span aria-hidden="true" className="mx-2 text-slate-300">
              /
            </span>
            <span className="font-medium text-slate-800">
              {activeDescriptor
                ? (getBlessedAppRailLabel(activeDescriptor.id) ??
                  t(activeDescriptor.labelKey))
                : t('shell-frame.breadcrumb.unknown')}
            </span>
          </nav>
          {globalStatus}
          <button
            aria-label={t('shell-frame.search.open')}
            className="mx-auto flex h-9 w-full max-w-xl items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-left text-sm text-slate-500 shadow-sm transition-colors hover:border-slate-300 hover:bg-white"
            data-testid="v1-shell-command-trigger"
            onClick={onOpenCommandPalette}
            type="button"
          >
            <Search aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">
              {t('shell-frame.search.placeholder')}
            </span>
            <kbd className="ml-auto rounded border border-slate-200 bg-white px-1.5 py-0.5 font-sans text-[11px] font-medium text-slate-500">
              <Command aria-hidden="true" className="mr-0.5 inline size-3" />K
            </kbd>
          </button>
          {schedulingDescriptor && SchedulingIcon ? (
            <button
              aria-current={
                activeSurface === schedulingDescriptor.id ? 'page' : undefined
              }
              aria-label={t(schedulingDescriptor.labelKey)}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950"
              data-testid="scheduling-topbar-button"
              onClick={() => {
                onSurfaceChange(schedulingDescriptor.id);
              }}
              type="button"
            >
              <SchedulingIcon aria-hidden="true" className="size-4" />
            </button>
          ) : null}
          <NotificationBellSlot slot={notificationBellSlot} />
          <UserAvatar
            onOpenSettings={() => {
              onSurfaceChange('settings');
            }}
          />
        </header>

        {postTopbar}

        {hasSharedClientContext ? (
          <div data-testid="v1-shell-client-bar-slot">
            <SharedClientBar />
          </div>
        ) : null}

        <main
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          id="main-content"
          tabIndex={-1}
        >
          {children}
        </main>
      </section>
    </div>
  );
}
