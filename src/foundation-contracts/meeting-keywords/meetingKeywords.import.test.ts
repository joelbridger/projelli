import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { setDevFlagOverride } from '@/platform/flags';
import {
  renderRegisteredSettingsPanels,
  settingsModuleRegistry,
  type SettingsSectionRenderProps,
} from '@/features/settings';
import {
  type MeetingKeywordsImportProof,
  normalizeMeetingKeywordTerms,
} from './meetingKeywords.import';

describe('meeting keywords public import fixture', () => {
  afterEach(() => {
    setDevFlagOverride('meeting-keywords', undefined);
  });

  it('uses the public Meetings doorway from outside the feature', () => {
    const terms: MeetingKeywordsImportProof = {
      term: 'Retirement',
      count: 1,
      sourceArtifactIds: ['artifact-1'],
    };
    expect(normalizeMeetingKeywordTerms([' Retirement '])).toEqual([
      'Retirement',
    ]);
    expect(terms.sourceArtifactIds).toEqual(['artifact-1']);
  });

  it('registers and renders the Settings section through the public doorways', () => {
    setDevFlagOverride('meeting-keywords', true);
    expect(
      settingsModuleRegistry.descriptors.find(
        (descriptor) => descriptor.id === 'meeting-keywords'
      )
    ).toBeDefined();
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
    render(
      createElement(
        'div',
        null,
        renderRegisteredSettingsPanels('organization', props)
      )
    );
    expect(screen.getByTestId('meeting-keywords-settings')).toBeInTheDocument();
  });
});
