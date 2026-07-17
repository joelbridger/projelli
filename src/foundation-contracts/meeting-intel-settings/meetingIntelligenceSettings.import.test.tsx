import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMeetingIntelligenceSettingsStore,
  validateMeetingIntelligenceSettings,
} from '@/features/meetings';
import {
  renderRegisteredSettingsPanels,
  settingsModuleRegistry,
  type SettingsSectionRenderProps,
} from '@/features/settings';
import { setDevFlagOverride } from '@/platform/flags';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { compileMeetingIntelligenceSettingsImport } from './meetingIntelligenceSettings.import';

const props: SettingsSectionRenderProps = {
  getSetting: () => undefined,
  setSetting: () => undefined,
  onAction: () => undefined,
  filteredKeys: new Set(),
  searchQuery: '',
  searchActive: false,
  onNavigate: () => undefined,
  hasWorkspaceOpen: true,
};

function canonicalPort() {
  const records: LiveCrmRecord[] = [];
  return {
    records,
    workspaceRoot: '/meeting-intel-test',
    error: null,
    save: (record: LiveCrmRecord) => {
      const index = records.findIndex((candidate) => candidate.id === record.id);
      if (index >= 0) records[index] = record;
      else records.push(record);
      return Promise.resolve(record);
    },
    reloadRecords: () => Promise.resolve(records),
  } as Parameters<typeof createMeetingIntelligenceSettingsStore>[0];
}

describe('meeting intelligence Settings public contribution', () => {
  afterEach(() => {
    setDevFlagOverride('settings-shell-v1', undefined);
  });

  it('registers through the real Settings doorway and renders from the real Settings panel path', async () => {
    compileMeetingIntelligenceSettingsImport();
    setDevFlagOverride('settings-shell-v1', true);

    expect(
      settingsModuleRegistry.descriptors.some(
        (descriptor) => descriptor.id === 'meeting-intelligence-settings'
      )
    ).toBe(true);
    render(<>{renderRegisteredSettingsPanels('scheduling', props)}</>);

    expect(
      await screen.findByTestId('meeting-intelligence-settings')
    ).toBeInTheDocument();
  });

  it('is fully omitted before the panel can mount while the outer Settings flag is off', () => {
    setDevFlagOverride('settings-shell-v1', undefined);
    render(<>{renderRegisteredSettingsPanels('scheduling', props)}</>);

    expect(
      screen.queryByTestId('meeting-intelligence-settings')
    ).not.toBeInTheDocument();
  });

  it('persists a validated preference through the canonical record path and a fresh reader sees it', async () => {
    const port = canonicalPort();
    const first = createMeetingIntelligenceSettingsStore(port);
    await first.save({
      keywordTrackingEnabled: true,
      clientSignalsEnabled: true,
      displayPreference: 'compact',
    });

    const freshReader = createMeetingIntelligenceSettingsStore(port);
    await expect(freshReader.get()).resolves.toEqual({
      keywordTrackingEnabled: true,
      clientSignalsEnabled: true,
      displayPreference: 'compact',
    });
    expect(() =>
      validateMeetingIntelligenceSettings({
        keywordTrackingEnabled: true,
        clientSignalsEnabled: false,
        displayPreference: 'wide' as 'comfortable',
      })
    ).toThrow('Meeting intelligence settings are invalid.');
  });
});
