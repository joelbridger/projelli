/**
 * SettingsSections — unit tests for the 5-section Settings nav (v3.1).
 *
 * Covers:
 *   - Exactly 5 nav section buttons render (workspace / ai-privacy / account /
 *     voice / advanced-help).
 *   - Each section button carries the expected data-testid.
 *   - Every old category id (deep-link alias) routes to the correct section.
 *   - A representative control from each merged area is present in the correct
 *     section.
 *   - The "Connect AI" deep-link (category: 'ai') lands on AI & Privacy.
 *   - The "Connect email / integrations" deep-link lands on Account.
 *   - resolveSection returns the right SectionCategory for all known aliases.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { resolveSection, CATEGORY_ALIAS_MAP } from '@/settings/schema';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function renderModal(initialCategory?: string) {
  return render(
    <SettingsModal
      open
      onOpenChange={() => {}}
      // Cast needed because we're testing legacy alias ids too
      initialCategory={initialCategory as never}
    />,
  );
}

// ---------------------------------------------------------------------------
// resolveSection unit tests (pure function, no DOM)
// ---------------------------------------------------------------------------

describe('resolveSection / CATEGORY_ALIAS_MAP', () => {
  const cases: Array<[string, string]> = [
    // Canonical ids
    ['workspace',     'workspace'],
    ['ai-privacy',    'ai-privacy'],
    ['account',       'account'],
    ['voice',         'voice'],
    ['advanced-help', 'advanced-help'],
    // Legacy workspace aliases
    ['general', 'workspace'],
    ['editor',  'workspace'],
    ['files',   'workspace'],
    // Legacy AI & Privacy aliases
    ['ai',      'ai-privacy'],
    ['memory',  'ai-privacy'],
    ['privacy', 'ai-privacy'],
    // Legacy Account aliases
    ['license',      'account'],
    ['firm',         'account'],
    ['costs',        'account'],
    ['integrations', 'account'],
    // Legacy Voice alias
    ['voice', 'voice'],
    // Legacy Advanced & Help aliases
    ['shortcuts',  'advanced-help'],
    ['marketplace','advanced-help'],
    ['plugins',    'advanced-help'],
    ['templates',  'advanced-help'],
    ['updates',    'advanced-help'],
    ['about',      'advanced-help'],
    ['mobile',     'advanced-help'],
    ['onboarding', 'advanced-help'],
    ['advanced',   'advanced-help'],
  ];

  for (const [input, expected] of cases) {
    it(`resolveSection("${input}") === "${expected}"`, () => {
      expect(resolveSection(input)).toBe(expected);
    });
  }

  it('CATEGORY_ALIAS_MAP covers all 20 legacy ids + 5 canonical ids', () => {
    const legacy = [
      'general','editor','files','ai','memory','privacy',
      'license','firm','costs','integrations','voice',
      'shortcuts','marketplace','plugins','templates','updates',
      'about','mobile','onboarding','advanced',
    ];
    const canonical = ['workspace','ai-privacy','account','voice','advanced-help'];
    for (const id of [...legacy, ...canonical]) {
      expect(CATEGORY_ALIAS_MAP[id], `${id} missing from alias map`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Nav renders exactly 5 section buttons
// ---------------------------------------------------------------------------

describe('SettingsModal nav — 5 sections', () => {
  it('renders exactly 5 nav buttons', () => {
    renderModal();
    const navBtns = screen
      .getAllByRole('button')
      .filter((b) => (b.getAttribute('data-testid') ?? '').startsWith('settings-category-'));
    expect(navBtns).toHaveLength(5);
  });

  const sections: Array<{ id: string; label: string }> = [
    { id: 'workspace',     label: 'Workspace' },
    { id: 'ai-privacy',   label: 'AI & Privacy' },
    { id: 'account',      label: 'Account' },
    { id: 'voice',        label: 'Voice' },
    { id: 'advanced-help', label: 'Advanced & Help' },
  ];

  for (const { id, label } of sections) {
    it(`section "${id}" button is present with label "${label}"`, () => {
      renderModal();
      const btn = screen.getByTestId(`settings-category-${id}`);
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveTextContent(label);
    });
  }
});

// ---------------------------------------------------------------------------
// Deep-link aliases route to the correct section
// ---------------------------------------------------------------------------

describe('SettingsModal deep-link aliases', () => {
  it('initialCategory="ai" opens AI & Privacy (section button is present)', () => {
    renderModal('ai');
    // The ai-privacy section button must be present
    expect(screen.getByTestId('settings-category-ai-privacy')).toBeInTheDocument();
    // The section content is rendered
    expect(screen.getByTestId('section-ai-privacy')).toBeInTheDocument();
  });

  it('initialCategory="memory" opens AI & Privacy', () => {
    renderModal('memory');
    expect(screen.getByTestId('section-ai-privacy')).toBeInTheDocument();
  });

  it('initialCategory="privacy" opens AI & Privacy', () => {
    renderModal('privacy');
    expect(screen.getByTestId('section-ai-privacy')).toBeInTheDocument();
  });

  it('initialCategory="integrations" opens Account (Connections)', () => {
    renderModal('integrations');
    expect(screen.getByTestId('section-account')).toBeInTheDocument();
  });

  it('initialCategory="license" opens Account', () => {
    renderModal('license');
    expect(screen.getByTestId('section-account')).toBeInTheDocument();
  });

  it('initialCategory="firm" opens Account', () => {
    renderModal('firm');
    expect(screen.getByTestId('section-account')).toBeInTheDocument();
  });

  it('initialCategory="costs" opens Account', () => {
    renderModal('costs');
    expect(screen.getByTestId('section-account')).toBeInTheDocument();
  });

  it('initialCategory="general" opens Workspace', () => {
    renderModal('general');
    expect(screen.getByTestId('section-workspace')).toBeInTheDocument();
  });

  it('initialCategory="editor" opens Workspace', () => {
    renderModal('editor');
    expect(screen.getByTestId('section-workspace')).toBeInTheDocument();
  });

  it('initialCategory="files" opens Workspace', () => {
    renderModal('files');
    expect(screen.getByTestId('section-workspace')).toBeInTheDocument();
  });

  it('initialCategory="voice" opens Voice', () => {
    renderModal('voice');
    expect(screen.getByTestId('section-voice')).toBeInTheDocument();
  });

  it('initialCategory="shortcuts" opens Advanced & Help', () => {
    renderModal('shortcuts');
    expect(screen.getByTestId('section-advanced-help')).toBeInTheDocument();
  });

  it('initialCategory="marketplace" opens Advanced & Help', () => {
    renderModal('marketplace');
    expect(screen.getByTestId('section-advanced-help')).toBeInTheDocument();
  });

  it('initialCategory="updates" opens Advanced & Help', () => {
    renderModal('updates');
    expect(screen.getByTestId('section-advanced-help')).toBeInTheDocument();
  });

  it('initialCategory="about" opens Advanced & Help', () => {
    renderModal('about');
    expect(screen.getByTestId('section-advanced-help')).toBeInTheDocument();
  });

  it('initialCategory="onboarding" opens Advanced & Help', () => {
    renderModal('onboarding');
    expect(screen.getByTestId('section-advanced-help')).toBeInTheDocument();
  });

  it('initialCategory="plugins" opens Advanced & Help', () => {
    renderModal('plugins');
    expect(screen.getByTestId('section-advanced-help')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Sub-headers visible in each section
// ---------------------------------------------------------------------------

describe('SettingsModal section sub-headers', () => {
  it('Workspace section has Editor and Files sub-headers', () => {
    renderModal('workspace');
    expect(screen.getByTestId('subheader-editor')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-files')).toBeInTheDocument();
  });

  it('AI & Privacy section has AI / Memory / Privacy sub-headers', () => {
    renderModal('ai-privacy');
    expect(screen.getByTestId('subheader-ai')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-memory')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-privacy')).toBeInTheDocument();
  });

  it('Account section has Account / Firm / Usage / Connections sub-headers', () => {
    renderModal('account');
    expect(screen.getByTestId('subheader-account')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-firm')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-usage')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-connections')).toBeInTheDocument();
  });

  it('Advanced & Help section has Shortcuts / Extensions / Updates / Setup / About sub-headers', () => {
    renderModal('advanced-help');
    expect(screen.getByTestId('subheader-shortcuts')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-extensions')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-updates')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-setup')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-about')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Representative controls in each section
// ---------------------------------------------------------------------------

describe('SettingsModal controls per section', () => {
  it('Workspace: theme select is present', () => {
    renderModal('workspace');
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument();
  });

  it('Workspace: autoSave toggle is present (from editor)', () => {
    renderModal('workspace');
    expect(screen.getByTestId('setting-autoSave')).toBeInTheDocument();
  });

  it('Workspace: defaultNewFileType is present (from files)', () => {
    renderModal('workspace');
    expect(screen.getByTestId('setting-defaultNewFileType')).toBeInTheDocument();
  });

  it('AI & Privacy: memoryEnabled toggle is present (from memory)', () => {
    renderModal('ai-privacy');
    const toggle = screen.getByTestId('settings-memory-enabled');
    expect(toggle).toBeInTheDocument();
  });

  it('AI & Privacy: factsInjection toggle is present (from memory)', () => {
    renderModal('ai-privacy');
    expect(screen.getByTestId('settings-facts-inject-toggle')).toBeInTheDocument();
  });

  it('AI & Privacy: manageApiKeys action link is present (from ai)', () => {
    renderModal('ai-privacy');
    expect(screen.getByTestId('setting-manageApiKeys')).toBeInTheDocument();
  });

  it('Voice: voiceEnabled toggle is present', () => {
    renderModal('voice');
    expect(screen.getByTestId('setting-voiceEnabled')).toBeInTheDocument();
  });

  it('Voice: ttsEnabled toggle is present', () => {
    renderModal('voice');
    expect(screen.getByTestId('setting-ttsEnabled')).toBeInTheDocument();
  });

  it('Advanced & Help: autoUpdateCheck toggle is present (from updates)', () => {
    renderModal('advanced-help');
    expect(screen.getByTestId('setting-autoUpdateCheck')).toBeInTheDocument();
  });

  it('Advanced & Help: aboutWebsite action is present (from about)', () => {
    renderModal('advanced-help');
    expect(screen.getByTestId('setting-aboutWebsite')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// No legacy category buttons in sidebar (only 5 canonical)
// ---------------------------------------------------------------------------

describe('SettingsModal sidebar does not expose old category ids', () => {
  const legacyIds = [
    'general','editor','files','ai','memory','privacy',
    'license','firm','costs','integrations',
    'shortcuts','marketplace','plugins','templates','updates',
    'about','mobile','onboarding','advanced',
  ];
  for (const id of legacyIds) {
    it(`sidebar has no button data-testid="settings-category-${id}"`, () => {
      renderModal();
      expect(screen.queryByTestId(`settings-category-${id}`)).not.toBeInTheDocument();
    });
  }
});
