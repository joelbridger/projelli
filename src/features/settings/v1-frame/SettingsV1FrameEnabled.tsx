import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Building2,
  ChevronRight,
  Download,
  MoreVertical,
  RotateCcw,
  Search,
  Upload,
  UserRound,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EV_OPEN_ACCOUNT } from '@/config/identity';
import { useFirmStore } from '@/platform/firm/firmStore';
import { useProfileStore } from '@/platform/profile/profileStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { resolveSection, type SectionCategory } from '@/platform/settings/schema';
import { useFlagRegistryVersion } from '@/platform/flags';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { IconButton } from '@/ui/kp';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { getVisibleSettingsSectionDescriptors } from '@/features/settings/registry/settingsModuleRegistry';
import { renderRegisteredSettingsPanels } from '@/features/settings/registry/sectionRendererBindings';
import { getSettingsSearchResults } from '@/features/settings/settingsSearch';
import type {
  SettingsSectionDescriptor,
  SettingsSectionRenderProps,
} from '@/features/settings/registry/types';
import type { SettingsV1Runtime } from './runtime';

// Legacy Settings sections register their panel renderers as a module side
// effect. This import happens only inside the flag-on lazy chunk, so the dark
// path never loads it or any Settings data hooks.
import '@/features/settings/SettingsContent';

export interface SettingsV1FrameEnabledProps {
  runtime: SettingsV1Runtime;
}

function SectionDoorway({
  active,
  onSelect,
  section,
}: {
  active: boolean;
  onSelect: (section: SectionCategory) => void;
  section: SettingsSectionDescriptor;
}) {
  const { t } = useTranslation();

  return (
    <button
      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950"
      aria-current={active ? 'page' : undefined}
      data-testid={`settings-v1-section-${section.id}`}
      onClick={() => {
        onSelect(section.id);
      }}
      type="button"
    >
      <span>{t(section.labelKey)}</span>
      <ChevronRight aria-hidden="true" className="size-4 text-slate-400" />
    </button>
  );
}

function SettingsActionsMenu({
  onExport,
  onImport,
  onReset,
}: {
  onExport: () => void;
  onImport: () => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          icon={MoreVertical}
          label="More settings actions"
          variant="secondary"
          size="md"
          data-testid="settings-v1-actions-menu"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem data-testid="settings-v1-export" onSelect={onExport}>
          <Download className="mr-2 size-4" aria-hidden />
          Export settings
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="settings-v1-import" onSelect={onImport}>
          <Upload className="mr-2 size-4" aria-hidden />
          Import settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="settings-v1-reset"
          className="text-destructive focus:text-destructive"
          onSelect={onReset}
        >
          <RotateCcw className="mr-2 size-4" aria-hidden />
          Reset settings...
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Enabled-only Settings frame. Its shell owns one rail while the real Settings
 * host capabilities (live templates, nested destinations, search, and backup
 * actions) stay available to the registered legacy and feature panels.
 */
export function SettingsV1FrameEnabled({
  runtime,
}: SettingsV1FrameEnabledProps) {
  const { t } = useTranslation();
  const soloName = useProfileStore((state) => state.soloName);
  const profileFirmName = useProfileStore((state) => state.firmName);
  const firm = useFirmStore((state) => state.session);
  const { getSetting, setSetting, exportSettings, importSettings, resetAll } =
    useSettingsStore();
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeExtraId, setActiveExtraId] = useState<string | null>(null);
  useFlagRegistryVersion();
  const sections = getVisibleSettingsSectionDescriptors();
  const requestedSection = runtime.settings.pageFocus?.category
    ? resolveSection(runtime.settings.pageFocus.category)
    : undefined;
  const [activeSection, setActiveSection] = useState<SectionCategory>(
    requestedSection ?? sections[0]?.id ?? 'workspace'
  );
  const [previousRequestedSection, setPreviousRequestedSection] =
    useState(requestedSection);
  if (requestedSection !== previousRequestedSection) {
    setPreviousRequestedSection(requestedSection);
    if (requestedSection) {
      setActiveExtraId(null);
      setActiveSection(requestedSection);
    }
  }

  const searchActive = searchQuery.trim().length > 0;
  const { filteredKeys, visibleSectionIds } = useMemo(
    () => getSettingsSearchResults(searchQuery, sections),
    [searchQuery, sections],
  );
  const visibleSections = sections.filter((section) => visibleSectionIds.has(section.id));
  const effectiveSection = visibleSections.some(
    (section) => section.id === activeSection
  )
    ? activeSection
    : (visibleSections[0]?.id ?? sections[0]?.id ?? 'workspace');
  const activeExtra = !searchActive
    ? runtime.settings.extraSections.find((section) => section.id === activeExtraId)
    : undefined;
  const workspaceSections = visibleSections.filter(
    (section) => section.id !== 'organization'
  );
  const organizationSections = visibleSections.filter(
    (section) => section.id === 'organization'
  );
  const profileName = soloName.trim() || t('settings-v1.personal.default-name');
  const workspaceName =
    profileFirmName.trim() ||
    firm?.org?.name ||
    t('settings-v1.workspace.default-name');
  const selectSection = useCallback((section: SectionCategory) => {
    setSearchQuery('');
    setActiveExtraId(null);
    setActiveSection(section);
  }, []);
  const sectionProps: SettingsSectionRenderProps = {
    getSetting,
    setSetting,
    onAction: runtime.settings.action,
    filteredKeys,
    searchQuery,
    searchActive,
    auditEntries: runtime.audit.entries,
    templates: runtime.settings.loadTemplates(),
    onRestartOnboarding: runtime.settings.restartOnboarding,
    onNavigate: selectSection,
    hasWorkspaceOpen: Boolean(runtime.workspace.rootPath),
  };
  const handleExport = useCallback(() => {
    const blob = new Blob([exportSettings()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lantern-settings.json';
    link.click();
    URL.revokeObjectURL(url);
  }, [exportSettings]);
  const handleImportFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const imported = reader.result;
        if (typeof imported !== 'string' || !importSettings(imported)) {
          alert('Failed to import settings. The file may be invalid.');
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    },
    [importSettings]
  );
  const handleReset = useCallback(() => {
    void confirm('Reset all settings to their defaults? This cannot be undone.', {
      title: 'Reset settings',
      confirmLabel: 'Reset',
      variant: 'destructive',
    })
      .then((confirmed) => {
        if (confirmed) resetAll();
      })
      .catch((error: unknown) => {
        console.error('Could not reset Settings.', error);
      });
  }, [confirm, resetAll]);

  return (
    <>
      <div
        className="flex min-h-0 flex-1 overflow-hidden bg-slate-50 text-slate-950"
        data-testid="settings-v1-frame"
      >
        <aside
          aria-label={t('settings-v1.frame.navigation-label')}
          className="w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-4"
        >
          <div className="mb-5 flex items-center gap-2">
            <label className="sr-only" htmlFor="settings-v1-search">
              {t('settings.modal.search-placeholder')}
            </label>
            <div className="relative min-w-0 flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
              <input
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
                data-testid="settings-v1-search"
                id="settings-v1-search"
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                }}
                placeholder={t('settings.modal.search-placeholder')}
                value={searchQuery}
              />
            </div>
            <SettingsActionsMenu
              onExport={handleExport}
              onImport={() => {
                fileInputRef.current?.click();
              }}
              onReset={handleReset}
            />
          </div>

          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
              {t('settings-v1.personal.eyebrow')}
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="mt-2 flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-left transition-colors hover:bg-slate-50"
                  data-testid="settings-v1-profile-entry"
                  type="button"
                >
                  <span className="flex size-9 items-center justify-center rounded-full bg-slate-900 text-white">
                    <UserRound aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {profileName}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {t('settings-v1.personal.profile-entry')}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 text-slate-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>{profileName}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-testid="settings-v1-profile-account"
                  onSelect={() => {
                    window.dispatchEvent(new CustomEvent(EV_OPEN_ACCOUNT));
                  }}
                >
                  {t('settings-v1.personal.account-menu')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="settings-v1-profile-personal-settings"
                  onSelect={() => {
                    selectSection('personal');
                  }}
                >
                  {t('settings-v1.personal.settings-menu')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="mb-6">
            <p className="px-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
              {t('settings-v1.workspace.eyebrow')}
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="mt-2 flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-left transition-colors hover:bg-slate-50"
                  data-testid="settings-v1-workspace-entry"
                  type="button"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                    <Building2 aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {workspaceName}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {t('settings-v1.workspace.entry')}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 text-slate-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>{workspaceName}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-testid="settings-v1-workspace-settings"
                  onSelect={() => {
                    selectSection('workspace');
                  }}
                >
                  {t('settings-v1.workspace.settings-menu')}
                </DropdownMenuItem>
                {sections.some((section) => section.id === 'organization') ? (
                  <DropdownMenuItem
                    data-testid="settings-v1-workspace-organization"
                    onSelect={() => {
                      selectSection('organization');
                    }}
                  >
                    {t('settings-v1.workspace.organization-menu')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <nav className="space-y-5">
            <section aria-labelledby="settings-v1-workspace-heading">
              <h2
                className="px-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400"
                id="settings-v1-workspace-heading"
              >
                {t('settings-v1.workspace.sections-heading')}
              </h2>
              <div className="mt-2 space-y-1">
                {workspaceSections.map((section) => (
                  <SectionDoorway
                    active={!activeExtra && effectiveSection === section.id}
                    key={section.id}
                    onSelect={selectSection}
                    section={section}
                  />
                ))}
              </div>
            </section>

            {organizationSections.length > 0 ? (
              <section aria-labelledby="settings-v1-organization-heading">
                <h2
                  className="px-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400"
                  id="settings-v1-organization-heading"
                >
                  {t('settings-v1.organization.eyebrow')}
                </h2>
                <div
                  className="mt-2 space-y-1"
                  data-testid="settings-v1-organization"
                >
                  {organizationSections.map((section) => (
                    <SectionDoorway
                      active={!activeExtra && effectiveSection === section.id}
                      key={section.id}
                      onSelect={selectSection}
                      section={section}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {runtime.settings.extraSections.length > 0 ? (
              <section aria-label="More settings destinations">
                <div className="space-y-1">
                  {runtime.settings.extraSections.map((section) => (
                    <button
                      aria-current={activeExtra?.id === section.id ? 'page' : undefined}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950"
                      data-testid={section.testid}
                      key={section.id}
                      onClick={() => {
                        setSearchQuery('');
                        setActiveExtraId(section.id);
                      }}
                      type="button"
                    >
                      <span>{section.label}</span>
                      <ChevronRight aria-hidden className="size-4 text-slate-400" />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </nav>
        </aside>

        <main
          className="min-w-0 flex-1 overflow-auto"
          data-testid="settings-v1-content"
        >
          {activeExtra
            ? activeExtra.content
            : renderRegisteredSettingsPanels(effectiveSection, sectionProps)}
        </main>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImportFile}
        />
      </div>
      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
