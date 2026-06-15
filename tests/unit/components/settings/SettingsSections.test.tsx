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
 * Expand an accordion sub-section by clicking its header. Sub-section bodies
 * are collapsed by default (only the FIRST is open), so a control that lives in
 * a non-first group must be revealed first. The clickable header carries the
 * testid `${subheaderTestid}-heading`.
 */
function expandSubsection(subheaderTestid: string) {
  fireEvent.click(screen.getByTestId(`${subheaderTestid}-heading`));
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

  it('AI & Privacy: manageApiKeys action link is present (from ai, default-open)', () => {
    renderModal('ai-privacy');
    // AI is the first sub-section, so it is open by default.
    expect(screen.getByTestId('setting-manageApiKeys')).toBeInTheDocument();
  });

  it('Voice: voiceEnabled toggle is present (Voice Input, default-open)', () => {
    renderModal('voice');
    expect(screen.getByTestId('setting-voiceEnabled')).toBeInTheDocument();
  });

  it('Voice: ttsEnabled toggle is present (from TTS, after expanding)', () => {
    renderModal('voice');
    expandSubsection('subheader-tts');
    expect(screen.getByTestId('setting-ttsEnabled')).toBeInTheDocument();
  });

  it('Advanced & Help: autoUpdateCheck toggle is present (from updates, after expanding)', () => {
    renderModal('advanced-help');
    expandSubsection('subheader-updates');
    expect(screen.getByTestId('setting-autoUpdateCheck')).toBeInTheDocument();
  });

  it('Advanced & Help: aboutWebsite action is present (from about, after expanding)', () => {
    renderModal('advanced-help');
    expandSubsection('subheader-about');
    expect(screen.getByTestId('setting-aboutWebsite')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Accordion sub-sections (R62.2): one open at a time, first default-open,
// section switch resets to the first.
// ---------------------------------------------------------------------------

describe('SettingsModal accordion sub-sections', () => {
  it('only the FIRST sub-section is open by default (Workspace: General open, Editor/Files closed)', () => {
    renderModal('workspace');
    // General (first) is open → its control is visible.
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument();
    // Editor + Files bodies are collapsed → their controls are absent.
    expect(screen.queryByTestId('setting-autoSave')).not.toBeInTheDocument();
    expect(screen.queryByTestId('setting-defaultNewFileType')).not.toBeInTheDocument();
    // But every sub-section HEADER still renders.
    expect(screen.getByTestId('subheader-editor')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-files')).toBeInTheDocument();
  });

  it('expanding a sub-section reveals its body', () => {
    renderModal('workspace');
    expect(screen.queryByTestId('setting-autoSave')).not.toBeInTheDocument();
    expandSubsection('subheader-editor');
    expect(screen.getByTestId('setting-autoSave')).toBeInTheDocument();
  });

  it('opening a second sub-section collapses the first (only one open at a time)', () => {
    renderModal('workspace');
    // General open by default.
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument();
    // Open Files → General must close.
    expandSubsection('subheader-files');
    expect(screen.getByTestId('setting-defaultNewFileType')).toBeInTheDocument();
    expect(screen.queryByTestId('setting-theme')).not.toBeInTheDocument();
    // Editor stays closed throughout.
    expect(screen.queryByTestId('setting-autoSave')).not.toBeInTheDocument();
  });

  it('the open sub-section header reports aria-expanded=true; closed ones false', () => {
    renderModal('workspace');
    expect(
      screen.getByTestId('subheader-general-heading').getAttribute('aria-expanded'),
    ).toBe('true');
    expect(
      screen.getByTestId('subheader-editor-heading').getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('clicking the already-open header keeps it open (section is never empty)', () => {
    renderModal('workspace');
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument();
    expandSubsection('subheader-general'); // click the open one
    // Still open — one group is always visible.
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument();
  });

  it('switching top-level sections resets to that section first sub-section open', () => {
    renderModal('workspace');
    // Open a non-first sub-section in Workspace.
    expandSubsection('subheader-files');
    expect(screen.getByTestId('setting-defaultNewFileType')).toBeInTheDocument();
    // Switch to AI & Privacy → its FIRST sub-section (AI) is open, not a stale one.
    fireEvent.click(screen.getByTestId('settings-category-ai-privacy'));
    expect(screen.getByTestId('setting-manageApiKeys')).toBeInTheDocument(); // AI (first) open
    expect(screen.queryByTestId('settings-memory-enabled')).not.toBeInTheDocument(); // Memory closed
    // Switch back to Workspace → General (first) open again, Files reset to closed.
    fireEvent.click(screen.getByTestId('settings-category-workspace'));
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument();
    expect(screen.queryByTestId('setting-defaultNewFileType')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Search reveals matching controls regardless of accordion state (R62.2).
// ---------------------------------------------------------------------------

describe('SettingsModal search expands matching sub-sections', () => {
  it('a search match in a non-first sub-section is revealed even though it is collapsed by default', () => {
    renderModal('workspace');
    // "Auto Save" lives in the Editor group (non-first, collapsed by default).
    expect(screen.queryByTestId('setting-autoSave')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'auto save' },
    });
    // Now revealed by the search expansion.
    expect(screen.getByTestId('setting-autoSave')).toBeInTheDocument();
  });

  it('clearing the search restores the default accordion (first open, rest collapsed)', () => {
    renderModal('workspace');
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'auto save' },
    });
    expect(screen.getByTestId('setting-autoSave')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: '' },
    });
    // Back to default: General open, Editor collapsed again.
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument();
    expect(screen.queryByTestId('setting-autoSave')).not.toBeInTheDocument();
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
