import type { ComponentProps } from 'react';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useMeetingIntelligenceSettingsStore,
  validateMeetingIntelligenceSettings,
} from '@/features/meetings';
import { SettingsV1Surface, settingsModuleRegistry } from '@/features/settings';
import { setDevFlagOverride } from '@/platform/flags';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { compileMeetingIntelligenceSettingsImport } from './meetingIntelligenceSettings.import';

const boundary = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  invoke:
    vi.fn<
      (command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>
    >(),
}));
const meetingStoreMounts = vi.hoisted(() => ({ count: 0 }));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) =>
    boundary.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: () => Promise.resolve(),
}));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) =>
    selector({ rootPath: '/meeting-intel-test' }),
}));
vi.mock('@/platform/matter/matterStore', () => {
  const state = { matters: [], activeMatterId: null };
  return {
    useMatterStore: Object.assign(
      <T,>(selector: (source: typeof state) => T) => selector(state),
      { getState: () => state }
    ),
  };
});
vi.mock('@/platform/crm/store', () => ({
  getCrmEngineFreshness: () => ({ kind: 'idle' }),
  subscribeCrmEngineFreshness: () => () => undefined,
}));
vi.mock('@/platform/crm/liveRecordRelay', () => ({
  clearLiveRecordRelay: vi.fn(),
  ensureLiveRecordRelay: vi.fn(() => Promise.resolve(null)),
  removeLiveRecordRelayWriter: vi.fn(),
  publishLiveRecord: vi.fn(),
}));
vi.mock('@/features/meetings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/meetings')>();
  return {
    ...actual,
    useMeetingIntelligenceSettingsStore: () => {
      meetingStoreMounts.count += 1;
      return actual.useMeetingIntelligenceSettingsStore();
    },
    useMeetingTemplateStore: () => {
      meetingStoreMounts.count += 1;
      return actual.useMeetingTemplateStore();
    },
    useMeetingTypeStore: () => {
      meetingStoreMounts.count += 1;
      return actual.useMeetingTypeStore();
    },
  };
});

type SettingsRuntime = ComponentProps<typeof SettingsV1Surface>['runtime'];

const runtime: SettingsRuntime = {
  legacy: {
    settings: () => (
      <div data-testid="legacy-settings-body">Legacy settings</div>
    ),
  },
  settings: {
    action: vi.fn(),
    restartOnboarding: vi.fn(),
    loadTemplates: () => [],
    extraSections: [],
  },
  audit: { entries: [] },
  workspace: { rootPath: '/meeting-intel-test' },
};

function countCalls(command: string): number {
  return boundary.invoke.mock.calls.filter(([name]) => name === command).length;
}

async function openMeetingIntelligenceSettings() {
  const mounted = render(<SettingsV1Surface runtime={runtime} />);
  await screen.findByTestId('settings-v1-frame');
  fireEvent.click(screen.getByTestId('settings-v1-section-scheduling'));
  await screen.findByTestId('meeting-intelligence-settings');
  return mounted;
}

describe('meeting intelligence Settings public contribution', () => {
  beforeEach(() => {
    boundary.records = [];
    meetingStoreMounts.count = 0;
    boundary.invoke.mockReset();
    boundary.invoke.mockImplementation((command, args) => {
      if (command === 'crm_live_list')
        return Promise.resolve(structuredClone(boundary.records));
      if (command === 'crm_live_upsert' && args?.record) {
        const record = structuredClone(args.record);
        boundary.records = boundary.records.some(
          (item) => item.id === record.id
        )
          ? boundary.records.map((item) =>
              item.id === record.id ? record : item
            )
          : [...boundary.records, record];
        return Promise.resolve(structuredClone(record));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
    setDevFlagOverride('settings-shell-v1', undefined);
  });

  afterEach(() => {
    setDevFlagOverride('settings-shell-v1', undefined);
    vi.clearAllMocks();
  });

  it('uses the production Settings registry descriptor, not a test registration', () => {
    expect(compileMeetingIntelligenceSettingsImport()).toBe(
      settingsModuleRegistry.descriptors.find(
        (descriptor) => descriptor.id === 'meeting-intelligence-settings'
      )
    );
  });

  it('does not mount any meeting stores or load records while settings-shell-v1 is off', () => {
    render(<SettingsV1Surface runtime={runtime} />);

    expect(screen.getByTestId('legacy-settings-body')).toBeInTheDocument();
    expect(meetingStoreMounts.count).toBe(0);
    expect(boundary.invoke).not.toHaveBeenCalled();
  });

  it('saves a clicked toggle through the canonical record path and a fresh reader reloads it', async () => {
    setDevFlagOverride('settings-shell-v1', true);
    const writer = await openMeetingIntelligenceSettings();

    fireEvent.click(
      screen.getByTestId('meeting-intelligence-settings-keywordTrackingEnabled')
    );
    await waitFor(() => {
      expect(
        boundary.records.find(
          (record) => record.kind === 'meeting_intelligence_settings'
        )
      ).toMatchObject({
        keywordTrackingEnabled: true,
        clientSignalsEnabled: false,
        displayPreference: 'comfortable',
      });
    });
    expect(countCalls('crm_live_upsert')).toBe(1);
    writer.unmount();

    const loadsBeforeFreshReader = countCalls('crm_live_list');
    const freshReader = renderHook(() => useMeetingIntelligenceSettingsStore());
    const saved = await act(async () => freshReader.result.current.get());
    expect(saved).toEqual({
      keywordTrackingEnabled: true,
      clientSignalsEnabled: false,
      displayPreference: 'comfortable',
    });
    expect(countCalls('crm_live_list')).toBeGreaterThan(loadsBeforeFreshReader);
    freshReader.unmount();
  });

  it('rejects an invalid preference with the real validator', () => {
    expect(() =>
      validateMeetingIntelligenceSettings({
        keywordTrackingEnabled: true,
        clientSignalsEnabled: false,
        displayPreference: 'wide' as 'comfortable',
      })
    ).toThrow('Meeting intelligence settings are invalid.');
  });
});
