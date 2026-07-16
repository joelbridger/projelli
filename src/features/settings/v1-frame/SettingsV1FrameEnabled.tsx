import { useState } from 'react';
import { Building2, ChevronRight, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EV_OPEN_ACCOUNT } from '@/config/identity';
import { useFirmStore } from '@/platform/firm/firmStore';
import { useProfileStore } from '@/platform/profile/profileStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import {
  SETTINGS_SCHEMA,
  resolveSection,
  type SectionCategory,
} from '@/platform/settings/schema';
import { useFlagRegistryVersion } from '@/platform/flags';
import {
  getVisibleSettingsSectionDescriptors,
} from '@/features/settings/registry/settingsModuleRegistry';
import { renderRegisteredSettingsPanels } from '@/features/settings/registry/sectionRendererBindings';
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

/**
 * Enabled-only Settings frame. It renders the shared registered panels inside
 * one rail, rather than nesting the legacy Settings page inside a second rail.
 */
export function SettingsV1FrameEnabled({
  runtime,
}: SettingsV1FrameEnabledProps) {
  const { t } = useTranslation();
  const soloName = useProfileStore((state) => state.soloName);
  const profileFirmName = useProfileStore((state) => state.firmName);
  const firm = useFirmStore((state) => state.session);
  const { getSetting, setSetting } = useSettingsStore();
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
    if (requestedSection) setActiveSection(requestedSection);
  }
  const effectiveSection = sections.some(
    (section) => section.id === activeSection
  )
    ? activeSection
    : (sections[0]?.id ?? 'workspace');
  const workspaceSections = sections.filter(
    (section) => section.id !== 'organization'
  );
  const organizationSections = sections.filter(
    (section) => section.id === 'organization'
  );
  const profileName = soloName.trim() || t('settings-v1.personal.default-name');
  const workspaceName =
    profileFirmName.trim() ||
    firm?.org?.name ||
    t('settings-v1.workspace.default-name');
  const sectionProps: SettingsSectionRenderProps = {
    getSetting,
    setSetting,
    onAction: runtime.settings.action,
    filteredKeys: new Set(SETTINGS_SCHEMA.map((definition) => definition.key)),
    searchQuery: '',
    searchActive: false,
    auditEntries: runtime.audit.entries,
    onRestartOnboarding: runtime.settings.restartOnboarding,
    onNavigate: setActiveSection,
    hasWorkspaceOpen: Boolean(runtime.workspace.rootPath),
  };

  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden bg-slate-50 text-slate-950"
      data-testid="settings-v1-frame"
    >
      <aside
        aria-label={t('settings-v1.frame.navigation-label')}
        className="w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-4"
      >
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
            {t('settings-v1.personal.eyebrow')}
          </p>
          <button
            className="mt-2 flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-left transition-colors hover:bg-slate-50"
            data-testid="settings-v1-profile-entry"
            onClick={() => {
              window.dispatchEvent(new CustomEvent(EV_OPEN_ACCOUNT));
            }}
            type="button"
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-slate-900 text-white">
              <UserRound aria-hidden="true" className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                {profileName}
              </span>
              <span className="block text-xs text-slate-500">
                {t('settings-v1.personal.profile-entry')}
              </span>
            </span>
          </button>
        </div>

        <div className="mb-6">
          <p className="px-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
            {t('settings-v1.workspace.eyebrow')}
          </p>
          <button
            className="mt-2 flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-left transition-colors hover:bg-slate-50"
            data-testid="settings-v1-workspace-entry"
            onClick={() => {
              setActiveSection('workspace');
            }}
            type="button"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
              <Building2 aria-hidden="true" className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                {workspaceName}
              </span>
              <span className="block text-xs text-slate-500">
                {t('settings-v1.workspace.entry')}
              </span>
            </span>
          </button>
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
                  active={effectiveSection === section.id}
                  key={section.id}
                  onSelect={setActiveSection}
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
                    active={effectiveSection === section.id}
                    key={section.id}
                    onSelect={setActiveSection}
                    section={section}
                  />
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
        {renderRegisteredSettingsPanels(effectiveSection, sectionProps)}
      </main>
    </div>
  );
}
