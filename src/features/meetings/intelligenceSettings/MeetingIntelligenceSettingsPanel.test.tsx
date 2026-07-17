import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  MeetingIntelligenceSettingsStore,
  MeetingTemplateStore,
  MeetingTypeStore,
} from '@/features/meetings';
import {
  MeetingIntelligenceSettingsContent,
  type IntelligenceStores,
} from './MeetingIntelligenceSettingsPanel';

function stores(
  initialTemplates: MeetingTemplateStore['templates'] = []
): IntelligenceStores & {
  saveSettings: ReturnType<typeof vi.fn>;
  saveTypes: ReturnType<typeof vi.fn>;
  saveTemplates: ReturnType<typeof vi.fn>;
} {
  const saveSettings = vi.fn(
    (next: MeetingIntelligenceSettingsStore['settings']) =>
      Promise.resolve(next)
  );
  const saveTypes = vi.fn((next: readonly { id: string; label: string }[]) =>
    Promise.resolve(next)
  );
  const saveTemplates = vi.fn((next: MeetingTemplateStore['templates']) =>
    Promise.resolve(next)
  );
  const settings: MeetingIntelligenceSettingsStore = {
    settings: {
      keywordTrackingEnabled: false,
      clientSignalsEnabled: false,
      displayPreference: 'comfortable',
    },
    error: null,
    get: vi.fn(() => Promise.resolve(settings.settings)),
    save: saveSettings,
  };
  const types: MeetingTypeStore = {
    types: [],
    error: null,
    get: vi.fn(() => Promise.resolve([])),
    save: saveTypes,
  };
  const templates: MeetingTemplateStore = {
    templates: initialTemplates,
    error: null,
    get: vi.fn(() => Promise.resolve(initialTemplates)),
    save: saveTemplates,
  };
  return { settings, types, templates, saveSettings, saveTypes, saveTemplates };
}

describe('MeetingIntelligenceSettingsContent', () => {
  it('saves preference toggles and manages the two catalogues through supplied canonical stores', async () => {
    const source = stores();
    render(<MeetingIntelligenceSettingsContent stores={source} />);

    await screen.findByText('No meeting types have been added yet.');
    fireEvent.click(
      screen.getByTestId('meeting-intelligence-settings-keywordTrackingEnabled')
    );
    await waitFor(() => {
      expect(source.saveSettings).toHaveBeenCalledWith({
        keywordTrackingEnabled: true,
        clientSignalsEnabled: false,
        displayPreference: 'comfortable',
      });
    });

    fireEvent.change(
      screen.getByTestId('meeting-intelligence-settings-new-type'),
      {
        target: { value: 'Annual review' },
      }
    );
    fireEvent.click(
      screen.getByTestId('meeting-intelligence-settings-add-type')
    );
    await waitFor(() => {
      expect(source.saveTypes).toHaveBeenCalledWith([
        { id: 'annual-review', label: 'Annual review' },
      ]);
    });

    fireEvent.change(
      screen.getByTestId('meeting-intelligence-settings-new-template'),
      { target: { value: 'Annual review packet' } }
    );
    fireEvent.click(
      screen.getByTestId('meeting-intelligence-settings-artifact-agenda')
    );
    fireEvent.click(
      screen.getByTestId('meeting-intelligence-settings-add-template')
    );
    await waitFor(() => {
      expect(source.saveTemplates).toHaveBeenCalledWith([
        {
          id: 'annual-review-packet',
          label: 'Annual review packet',
          artifactKinds: ['agenda'],
        },
      ]);
    });
  });

  it('uses the localized artifact label for saved templates', async () => {
    const source = stores([
      {
        id: 'brief',
        label: 'Annual review brief',
        artifactKinds: ['pre-meeting-brief'],
      },
    ]);
    render(<MeetingIntelligenceSettingsContent stores={source} />);

    expect(
      await within(
        screen.getByTestId('meeting-intelligence-settings-templates')
      ).findByText('Pre-meeting brief')
    ).toBeInTheDocument();
    expect(screen.queryByText('pre-meeting-brief')).not.toBeInTheDocument();
  });
});
