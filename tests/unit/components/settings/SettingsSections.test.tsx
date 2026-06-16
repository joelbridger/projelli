/**
 * SettingsSections — unit tests for the 5-section Settings nav (v3.2).
 *
 * Covers:
 *   - Exactly 5 nav section buttons render (workspace / ai-privacy /
 *     voice / advanced / help). Account is now a separate AccountWindow.
 *   - Each section button carries the expected data-testid.
 *   - Every old category id (deep-link alias) routes to the correct section.
 *   - A representative control from each merged area is present in the correct
 *     section.
 *   - The "Connect AI" deep-link (category: 'ai') lands on AI & Privacy.
 *   - resolveSection returns the right SectionCategory for all known aliases.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { resolveSection, CATEGORY_ALIAS_MAP } from '@/settings/schema';

afterEach(() => {
  cleanup();
});

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

/**
 * Activate a tab sub-section by clicking its tab button. The first tab is
 * active by default, so clicking any non-first tab is required before asserting
 * on controls it contains. The tab button carries the testid
 * `${subheaderTestid}-heading`.
 */
function expandSubsection(subheaderTestid: string) {
  fireEvent.click(screen.getByTestId(`${subheaderTestid}-heading`));
}

// ---------------------------------------------------------------------------
// resolveSection unit tests (pure function, no DOM)
// ---------------------------------------------------------------------------

describe('resolveSection / CATEGORY_ALIAS_MAP', () => {
  const cases: Array<[string, string]> = [
    // Canonical ids (5 sections — Account is now AccountWindow, not a Settings section)
    ['workspace',  'workspace'],
    ['ai-privacy', 'ai-privacy'],
    ['voice',      'voice'],
    ['advanced',   'advanced'],
    ['help',       'help'],
    // Legacy workspace aliases
    ['general', 'workspace'],
    ['editor',  'workspace'],
    ['files',   'workspace'],
    // Legacy AI & Privacy aliases
    ['ai',      'ai-privacy'],
    ['memory',  'ai-privacy'],
    ['privacy', 'ai-privacy'],
    // Legacy account aliases — App.tsx intercepts these before Settings sees them;
    // if they ever reach resolveSection the safe fallback is 'workspace'
    ['account',      'workspace'],
    ['license',      'workspace'],
    ['firm',         'workspace'],
    ['costs',        'workspace'],
    ['integrations', 'workspace'],
    // Legacy Voice alias
    ['voice', 'voice'],
    // Legacy Advanced aliases
    ['marketplace', 'advanced'],
    ['templates',   'advanced'],
    ['updates',     'advanced'],
    ['mobile',      'advanced'],
    // Legacy Help aliases
    ['shortcuts',  'help'],
    ['about',      'help'],
    ['onboarding', 'help'],
  ];

  for (const [input, expected] of cases) {
    it(`resolveSection("${input}") === "${expected}"`, () => {
      expect(resolveSection(input)).toBe(expected);
    });
  }

  it('CATEGORY_ALIAS_MAP covers all 19 legacy ids + 5 canonical ids', () => {
    const legacy = [
      'general','editor','files','ai','memory','privacy',
      'license','firm','costs','integrations','voice',
      'shortcuts','marketplace','templates','updates',
      'about','mobile','onboarding',
    ];
    // 'account' is a legacy alias in the map (not a canonical section), so
    // check it separately
    expect(CATEGORY_ALIAS_MAP['account'], 'account missing from alias map').toBeDefined();
    const canonical = ['workspace','ai-privacy','voice','advanced','help'];
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
    { id: 'workspace',  label: 'Workspace' },
    { id: 'ai-privacy', label: 'AI & Privacy' },
    { id: 'voice',      label: 'Voice' },
    { id: 'advanced',   label: 'Advanced' },
    { id: 'help',       label: 'Help' },
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

  it('initialCategory="integrations" falls back to Workspace (App.tsx intercepts this for AccountWindow)', () => {
    renderModal('integrations');
    expect(screen.getByTestId('section-workspace')).toBeInTheDocument();
  });

  it('initialCategory="license" falls back to Workspace (App.tsx intercepts this for AccountWindow)', () => {
    renderModal('license');
    expect(screen.getByTestId('section-workspace')).toBeInTheDocument();
  });

  it('initialCategory="firm" falls back to Workspace (App.tsx intercepts this for AccountWindow)', () => {
    renderModal('firm');
    expect(screen.getByTestId('section-workspace')).toBeInTheDocument();
  });

  it('initialCategory="costs" falls back to Workspace (App.tsx intercepts this for AccountWindow)', () => {
    renderModal('costs');
    expect(screen.getByTestId('section-workspace')).toBeInTheDocument();
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

  it('initialCategory="shortcuts" opens Help', () => {
    renderModal('shortcuts');
    expect(screen.getByTestId('section-help')).toBeInTheDocument();
  });

  it('initialCategory="marketplace" opens Advanced', () => {
    renderModal('marketplace');
    expect(screen.getByTestId('section-advanced')).toBeInTheDocument();
  });

  it('initialCategory="updates" opens Advanced', () => {
    renderModal('updates');
    expect(screen.getByTestId('section-advanced')).toBeInTheDocument();
  });

  it('initialCategory="about" opens Help', () => {
    renderModal('about');
    expect(screen.getByTestId('section-help')).toBeInTheDocument();
  });

  it('initialCategory="onboarding" opens Help', () => {
    renderModal('onboarding');
    expect(screen.getByTestId('section-help')).toBeInTheDocument();
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

  it('Advanced section has Extensions / Updates / Advanced sub-headers', () => {
    renderModal('advanced');
    expect(screen.getByTestId('subheader-extensions')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-updates')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-advanced')).toBeInTheDocument();
  });

  it('Help section has Shortcuts / Setup / About sub-headers', () => {
    renderModal('help');
    expect(screen.getByTestId('subheader-shortcuts')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-setup')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-about')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Representative controls in each section
// ---------------------------------------------------------------------------

describe('SettingsModal controls per section', () => {
  it('Workspace: theme select is present (after expanding General)', () => {
    renderModal('workspace');
    expandSubsection('subheader-general');
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument();
  });

  it('Workspace: autoSave toggle is present (from editor, after expanding)', () => {
    renderModal('workspace');
    expandSubsection('subheader-editor');
    expect(screen.getByTestId('setting-autoSave')).toBeInTheDocument();
  });

  it('Workspace: defaultNewFileType is present (from files, after expanding)', () => {
    renderModal('workspace');
    expandSubsection('subheader-files');
    expect(screen.getByTestId('setting-defaultNewFileType')).toBeInTheDocument();
  });

  it('AI & Privacy: memoryEnabled toggle is present (from memory, after expanding)', () => {
    renderModal('ai-privacy');
    expandSubsection('subheader-memory');
    const toggle = screen.getByTestId('settings-memory-enabled');
    expect(toggle).toBeInTheDocument();
  });

  it('AI & Privacy: factsInjection toggle is present (from memory, after expanding)', () => {
    renderModal('ai-privacy');
    expandSubsection('subheader-memory');
    expect(screen.getByTestId('settings-facts-inject-toggle')).toBeInTheDocument();
  });

  it('AI & Privacy: manageApiKeys action link is present (from ai, after expanding)', () => {
    renderModal('ai-privacy');
    expandSubsection('subheader-ai');
    expect(screen.getByTestId('setting-manageApiKeys')).toBeInTheDocument();
  });

  it('Voice: voiceEnabled toggle is present (Voice Input, after expanding)', () => {
    renderModal('voice');
    expandSubsection('subheader-voice-input');
    expect(screen.getByTestId('setting-voiceEnabled')).toBeInTheDocument();
  });

  it('Voice: ttsEnabled toggle is present (from TTS, after expanding)', () => {
    renderModal('voice');
    expandSubsection('subheader-tts');
    expect(screen.getByTestId('setting-ttsEnabled')).toBeInTheDocument();
  });

  it('Advanced: autoUpdateCheck toggle is present (from updates, after expanding)', () => {
    renderModal('advanced');
    expandSubsection('subheader-updates');
    expect(screen.getByTestId('setting-autoUpdateCheck')).toBeInTheDocument();
  });

  it('Help: aboutWebsite action is present (from about, after expanding)', () => {
    renderModal('help');
    expandSubsection('subheader-about');
    expect(screen.getByTestId('setting-aboutWebsite')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tab sub-sections: first tab active by default; clicking switches panels;
// section switch resets to first tab of new section.
// ---------------------------------------------------------------------------

describe('SettingsModal tab sub-sections', () => {
  it('first tab (General) panel is in the DOM by default; Editor and Files panels are not', () => {
    renderModal('workspace');
    // First tab content is present.
    expect(screen.getByTestId('subsection-general')).toBeInTheDocument();
    // Non-first tabs are unmounted (not hidden, completely absent).
    expect(screen.queryByTestId('subsection-editor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('subsection-files')).not.toBeInTheDocument();
    // All tab buttons still render.
    expect(screen.getByTestId('subheader-general')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-editor')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-files')).toBeInTheDocument();
  });

  it('clicking the Editor tab reveals its panel and hides General', () => {
    renderModal('workspace');
    expect(screen.queryByTestId('subsection-editor')).not.toBeInTheDocument();
    expandSubsection('subheader-editor');
    expect(screen.getByTestId('subsection-editor')).toBeInTheDocument();
    expect(screen.getByTestId('setting-autoSave')).toBeInTheDocument();
    // General panel is now gone.
    expect(screen.queryByTestId('subsection-general')).not.toBeInTheDocument();
  });

  it('clicking Files tab shows Files panel; General and Editor panels are absent', () => {
    renderModal('workspace');
    expandSubsection('subheader-files');
    expect(screen.getByTestId('subsection-files')).toBeInTheDocument();
    expect(screen.queryByTestId('subsection-general')).not.toBeInTheDocument();
    expect(screen.queryByTestId('subsection-editor')).not.toBeInTheDocument();
    // Content in the active Files tab is accessible.
    expect(screen.getByTestId('setting-defaultNewFileType')).toBeInTheDocument();
  });

  it('first tab button has aria-selected="true"; others have aria-selected="false"', () => {
    renderModal('workspace');
    expect(
      screen.getByTestId('subheader-general-heading').getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByTestId('subheader-editor-heading').getAttribute('aria-selected'),
    ).toBe('false');
    expect(
      screen.getByTestId('subheader-files-heading').getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('clicking a tab updates aria-selected', () => {
    renderModal('workspace');
    expandSubsection('subheader-editor');
    expect(
      screen.getByTestId('subheader-editor-heading').getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByTestId('subheader-general-heading').getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('switching top-level sections resets to the first tab of the new section', () => {
    renderModal('workspace');
    // Activate a non-first tab in Workspace.
    expandSubsection('subheader-files');
    expect(screen.getByTestId('subsection-files')).toBeInTheDocument();
    // Switch to AI & Privacy → first tab (AI) should be active.
    fireEvent.click(screen.getByTestId('settings-category-ai-privacy'));
    expect(screen.getByTestId('subsection-ai')).toBeInTheDocument();
    expect(screen.queryByTestId('subsection-memory')).not.toBeInTheDocument();
    expect(screen.queryByTestId('subsection-privacy')).not.toBeInTheDocument();
    // First tab button for AI & Privacy is selected.
    expect(screen.getByTestId('subheader-ai-heading').getAttribute('aria-selected')).toBe('true');
    // AI header tab is present.
    expect(screen.getByTestId('subheader-ai')).toBeInTheDocument();
    // Switch back to Workspace → resets to first tab (General).
    fireEvent.click(screen.getByTestId('settings-category-workspace'));
    expect(screen.getByTestId('subsection-general')).toBeInTheDocument();
    expect(screen.queryByTestId('subsection-files')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Search auto-selects the matching tab (R62.2).
// ---------------------------------------------------------------------------

describe('SettingsModal search selects matching tab', () => {
  it('a search match in a non-first tab auto-selects that tab and shows its panel', () => {
    renderModal('workspace');
    // Editor is not the active tab by default (General is first).
    expect(screen.queryByTestId('subsection-editor')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'auto save' },
    });
    // The Editor tab is now auto-selected and its panel is in the DOM.
    expect(screen.getByTestId('subsection-editor')).toBeInTheDocument();
    expect(screen.getByTestId('setting-autoSave')).toBeInTheDocument();
  });

  it('clearing the search restores the default first-tab selection', () => {
    renderModal('workspace');
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'auto save' },
    });
    expect(screen.getByTestId('setting-autoSave')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: '' },
    });
    // Back to default: General tab is active, Editor panel is gone.
    expect(screen.getByTestId('subsection-general')).toBeInTheDocument();
    expect(screen.queryByTestId('subsection-editor')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// No legacy category buttons in sidebar (only 5 canonical)
// ---------------------------------------------------------------------------

describe('SettingsModal sidebar does not expose old category ids', () => {
  const legacyIds = [
    // account is now a legacy alias (Account moved to AccountWindow)
    'account',
    'general','editor','files','ai','memory','privacy',
    'license','firm','costs','integrations',
    'shortcuts','marketplace','templates','updates',
    'about','mobile','onboarding',
  ];
  for (const id of legacyIds) {
    it(`sidebar has no button data-testid="settings-category-${id}"`, () => {
      renderModal();
      expect(screen.queryByTestId(`settings-category-${id}`)).not.toBeInTheDocument();
    });
  }
});
