import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SettingsModal } from '@/features/settings/SettingsModal';
import { resolveSection, CATEGORY_ALIAS_MAP, SETTINGS_SCHEMA } from '@/platform/settings/schema';

afterEach(() => {
  cleanup();
});

function renderModal(initialCategory?: string) {
  return render(
    <SettingsModal
      open
      onOpenChange={() => {}}
      initialCategory={initialCategory as never}
    />,
  );
}

function navButtons() {
  return screen
    .getAllByRole('button')
    .filter((b) => (b.getAttribute('data-testid') ?? '').startsWith('settings-category-'));
}

describe('resolveSection / CATEGORY_ALIAS_MAP', () => {
  const cases: Array<[string, string]> = [
    ['workspace', 'workspace'],
    ['ai', 'ai'],
    ['memory', 'ai'],
    ['ai-privacy', 'ai'],
    ['privacy', 'privacy'],
    ['voice', 'voice'],
    ['advanced', 'advanced'],
    ['help', 'help'],
    ['general', 'workspace'],
    ['editor', 'workspace'],
    ['files', 'workspace'],
    ['account', 'workspace'],
    ['license', 'workspace'],
    ['firm', 'workspace'],
    ['costs', 'workspace'],
    ['integrations', 'workspace'],
    ['marketplace', 'advanced'],
    ['templates', 'advanced'],
    ['updates', 'advanced'],
    ['mobile', 'advanced'],
    ['shortcuts', 'help'],
    ['about', 'help'],
    ['onboarding', 'help'],
  ];

  for (const [input, expected] of cases) {
    it(`resolveSection("${input}") === "${expected}"`, () => {
      expect(resolveSection(input)).toBe(expected);
    });
  }

  it('CATEGORY_ALIAS_MAP covers legacy and canonical ids', () => {
    for (const id of cases.map(([input]) => input)) {
      expect(CATEGORY_ALIAS_MAP[id], `${id} missing from alias map`).toBeDefined();
    }
  });
});

describe('SettingsModal nav', () => {
  const sections: Array<{ id: string; label: string }> = [
    { id: 'workspace', label: 'Workspace' },
    { id: 'ai', label: 'AI' },
    { id: 'privacy', label: 'Privacy' },
    { id: 'voice', label: 'Voice' },
    { id: 'advanced', label: 'Advanced' },
    { id: 'help', label: 'Help' },
  ];

  it('renders exactly six standard nav buttons', () => {
    renderModal();
    expect(navButtons()).toHaveLength(6);
  });

  for (const { id, label } of sections) {
    it(`section "${id}" button is present with label "${label}"`, () => {
      renderModal();
      expect(screen.getByTestId(`settings-category-${id}`)).toHaveTextContent(label);
    });
  }
});

describe('SettingsModal deep-link aliases', () => {
  it.each([
    ['ai', 'section-ai'],
    ['memory', 'section-ai'],
    ['ai-privacy', 'section-ai'],
    ['privacy', 'section-privacy'],
    ['integrations', 'section-workspace'],
    ['license', 'section-workspace'],
    ['firm', 'section-workspace'],
    ['costs', 'section-workspace'],
    ['general', 'section-workspace'],
    ['editor', 'section-workspace'],
    ['files', 'section-workspace'],
    ['voice', 'section-voice'],
    ['shortcuts', 'section-help'],
    ['marketplace', 'section-advanced'],
    ['updates', 'section-advanced'],
    ['about', 'section-help'],
    ['onboarding', 'section-help'],
  ])('initialCategory="%s" opens %s', (initialCategory, sectionTestId) => {
    renderModal(initialCategory);
    expect(screen.getByTestId(sectionTestId)).toBeInTheDocument();
  });
});

describe('SettingsModal section groups', () => {
  it('Workspace section shows General, Editor, and Files groups together', () => {
    renderModal('workspace');
    expect(screen.getByTestId('subheader-general')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-editor')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-files')).toHaveTextContent('Files');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('AI section shows AI and Memory groups together', () => {
    renderModal('ai');
    expect(screen.getByTestId('subheader-ai')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-memory')).toBeInTheDocument();
  });

  it('Privacy section shows Privacy and Recording notice groups together', () => {
    renderModal('privacy');
    expect(screen.getByTestId('subheader-privacy')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-recording-notice')).toBeInTheDocument();
  });

  it('Advanced section shows Extensions, Updates, and Advanced groups together', () => {
    renderModal('advanced');
    expect(screen.getByTestId('subheader-extensions')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-updates')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-advanced')).toBeInTheDocument();
  });

  it('Help section shows Shortcuts, Setup, and About groups together', () => {
    renderModal('help');
    expect(screen.getByTestId('subheader-shortcuts')).toHaveTextContent('Shortcuts');
    expect(screen.getByTestId('subheader-setup')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-about')).toBeInTheDocument();
  });
});

describe('SettingsModal controls per section', () => {
  it('Workspace shows common controls without extra help speckles on obvious rows', () => {
    renderModal('workspace');

    expect(screen.getByText('Startup')).toBeInTheDocument();
    expect(screen.getByLabelText('Startup')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'About Startup' })).not.toBeInTheDocument();
    expect(screen.getByTestId('setting-autoSave')).toBeInTheDocument();
    expect(screen.getByTestId('setting-defaultNewFileType')).toBeInTheDocument();
  });

  it('AI keeps model keys and memory controls reachable', () => {
    renderModal('ai');

    expect(screen.getByTestId('setting-manageApiKeys')).toBeInTheDocument();
    expect(screen.getByTestId('settings-memory-enabled')).toBeInTheDocument();
    expect(screen.getByTestId('settings-facts-inject-toggle')).toBeInTheDocument();
  });

  it('Privacy keeps the Data Map link and recording notice settings reachable', () => {
    renderModal('privacy');

    expect(screen.getByTestId('privacy-open-data-map')).toHaveTextContent('Open Data Map');
    expect(screen.getByTestId('recording-notice-settings')).toBeInTheDocument();
  });

  it('Voice, Advanced, and Help representative controls are reachable', () => {
    renderModal('voice');
    expect(screen.getByTestId('setting-voiceEnabled')).toBeInTheDocument();
    expect(screen.getByTestId('setting-ttsEnabled')).toBeInTheDocument();

    cleanup();
    renderModal('advanced');
    expect(screen.getByTestId('setting-autoUpdateCheck')).toBeInTheDocument();
    expect(screen.getByTestId('setting-showAiCostMeters')).toBeInTheDocument();

    cleanup();
    renderModal('help');
    expect(screen.getByTestId('setting-aboutWebsite')).toBeInTheDocument();
  });

  it('search narrows to the matching group and clearing search restores the stack', () => {
    renderModal('workspace');

    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'auto save' },
    });
    expect(screen.getByTestId('subsection-editor')).toBeInTheDocument();
    expect(screen.getByTestId('setting-autoSave')).toBeInTheDocument();
    expect(screen.queryByTestId('subsection-general')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: '' },
    });
    expect(screen.getByTestId('subsection-general')).toBeInTheDocument();
    expect(screen.getByTestId('subsection-editor')).toBeInTheDocument();
  });
});

describe('showAiCostMeters setting', () => {
  it('is registered as an Advanced toggle that defaults to false', () => {
    const def = SETTINGS_SCHEMA.find((d) => d.key === 'showAiCostMeters');
    expect(def).toBeDefined();
    expect(def?.category).toBe('advanced');
    expect(def?.type).toBe('toggle');
    expect(def?.defaultValue).toBe(false);
  });
});
