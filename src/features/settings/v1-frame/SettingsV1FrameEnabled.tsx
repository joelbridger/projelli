import { Building2, ChevronRight, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EV_OPEN_ACCOUNT, EV_OPEN_SETTINGS } from '@/config/identity';
import { useFirmStore } from '@/platform/firm/firmStore';
import { useProfileStore } from '@/platform/profile/profileStore';
import { getSettingsSectionDescriptors } from '@/features/settings/registry/settingsModuleRegistry';
import type { SettingsSectionDescriptor } from '@/features/settings/registry/types';
import type { SettingsV1Runtime } from './runtime';

export interface SettingsV1FrameEnabledProps {
  runtime: SettingsV1Runtime;
}

function dispatchSettingsSection(section: string) {
  window.dispatchEvent(
    new CustomEvent(EV_OPEN_SETTINGS, { detail: { category: section } })
  );
}

function SectionDoorway({ section }: { section: SettingsSectionDescriptor }) {
  const { t } = useTranslation();

  return (
    <button
      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950"
      data-testid={`settings-v1-section-${section.id}`}
      onClick={() => {
        dispatchSettingsSection(section.id);
      }}
      type="button"
    >
      <span>{t(section.labelKey)}</span>
      <ChevronRight aria-hidden="true" className="size-4 text-slate-400" />
    </button>
  );
}

/**
 * Enabled-only Settings frame. It preserves the existing settings body and
 * derives its doorways from the shared settings registry rather than keeping a
 * second settings menu in this package.
 */
export function SettingsV1FrameEnabled({
  runtime,
}: SettingsV1FrameEnabledProps) {
  const { t } = useTranslation();
  const soloName = useProfileStore((state) => state.soloName);
  const profileFirmName = useProfileStore((state) => state.firmName);
  const firm = useFirmStore((state) => state.session);
  const sections = getSettingsSectionDescriptors();
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
              dispatchSettingsSection('workspace');
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
                <SectionDoorway key={section.id} section={section} />
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
                  <SectionDoorway key={section.id} section={section} />
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
        {runtime.legacy.settings()}
      </main>
    </div>
  );
}
