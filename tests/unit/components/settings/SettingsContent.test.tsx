/**
 * SettingsContent — unit tests for the reusable Settings body (R62 / R71).
 *
 * SettingsContent is the inner surface shared by the quick <SettingsModal>
 * (Dialog) and the full-page "Settings" nav tab. These tests exercise it
 * directly (no Dialog), covering:
 *   - The full-page variant renders the SurfaceHeader + 5-section nav + content + footer.
 *   - Deep-link aliases still resolve to the right section through the
 *     modal→content extraction (e.g. "ai" → AI & Privacy, "integrations" →
 *     Account).
 *   - Accordion: ALL sub-sections collapsed by default.
 *   - Accordion: clicking a closed header opens it (one at a time).
 *   - Accordion: clicking the open header collapses it (zero-open is valid).
 *   - Accordion: opening one closes others within the same section.
 *   - Accordion: switching top-level sections resets to all-collapsed.
 *   - Scroll-reset: the content scroll container returns to top when the
 *     active top-level section changes.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SettingsContent } from '@/components/settings/SettingsContent';

afterEach(() => {
  cleanup();
});

describe('SettingsContent — full-page variant', () => {
  it('renders the SurfaceHeader, 5-section nav, content area, and footer (page variant)', () => {
    render(<SettingsContent variant="page" />);
    // The shared content marker is present and tagged as the page variant.
    const content = screen.getByTestId('settings-content');
    expect(content).toBeInTheDocument();
    expect(content.getAttribute('data-variant')).toBe('page');

    // SurfaceHeader is rendered for the page variant.
    expect(screen.getByTestId('settings-surface-header')).toBeInTheDocument();

    // All 5 nav buttons render.
    const navBtns = screen
      .getAllByRole('button')
      .filter((b) => (b.getAttribute('data-testid') ?? '').startsWith('settings-category-'));
    expect(navBtns).toHaveLength(5);

    // Footer Export / Import / Reset are present.
    expect(screen.getByTestId('settings-export')).toBeInTheDocument();
    expect(screen.getByTestId('settings-import')).toBeInTheDocument();
    expect(screen.getByTestId('settings-reset')).toBeInTheDocument();

    // No modal close X in page variant (that belongs to the dialog chrome).
    expect(screen.getByTestId('settings-content-scroll')).toBeInTheDocument();
  });
});

describe('SettingsContent — deep-link resolution survives the extraction', () => {
  const cases: Array<[string, string]> = [
    ['ai', 'section-ai-privacy'],
    ['memory', 'section-ai-privacy'],
    ['privacy', 'section-ai-privacy'],
    ['integrations', 'section-account'],
    ['license', 'section-account'],
    ['firm', 'section-account'],
    ['costs', 'section-account'],
    ['general', 'section-workspace'],
    ['editor', 'section-workspace'],
    ['files', 'section-workspace'],
    ['voice', 'section-voice'],
    ['shortcuts', 'section-advanced-help'],
    ['marketplace', 'section-advanced-help'],
    ['updates', 'section-advanced-help'],
    ['about', 'section-advanced-help'],
  ];

  for (const [alias, sectionTestId] of cases) {
    it(`initialCategory="${alias}" lands on ${sectionTestId}`, () => {
      render(
        <SettingsContent variant="page" initialCategory={alias as never} />,
      );
      expect(screen.getByTestId(sectionTestId)).toBeInTheDocument();
    });
  }

  it('re-renders to a new section when initialCategory changes (deep-link update)', () => {
    const { rerender } = render(
      <SettingsContent variant="page" initialCategory={'general' as never} />,
    );
    expect(screen.getByTestId('section-workspace')).toBeInTheDocument();
    rerender(
      <SettingsContent variant="page" initialCategory={'license' as never} />,
    );
    expect(screen.getByTestId('section-account')).toBeInTheDocument();
  });
});

describe('SettingsContent — accordion all-collapsed by default', () => {
  it('workspace section starts with ALL sub-sections collapsed', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    // section is rendered but no sub-section body is open
    expect(screen.getByTestId('section-workspace')).toBeInTheDocument();
    // setting-theme lives in the "General" sub-section body — it should NOT be visible
    expect(screen.queryByTestId('setting-theme')).not.toBeInTheDocument();
    // setting-autoSave lives in "Editor" — also collapsed
    expect(screen.queryByTestId('setting-autoSave')).not.toBeInTheDocument();
    // setting-defaultNewFileType lives in "Files" — also collapsed
    expect(screen.queryByTestId('setting-defaultNewFileType')).not.toBeInTheDocument();
  });

  it('all sub-section headers report aria-expanded=false by default', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    const generalBtn = screen.getByTestId('subheader-general-heading');
    const editorBtn = screen.getByTestId('subheader-editor-heading');
    const filesBtn = screen.getByTestId('subheader-files-heading');
    expect(generalBtn.getAttribute('aria-expanded')).toBe('false');
    expect(editorBtn.getAttribute('aria-expanded')).toBe('false');
    expect(filesBtn.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('SettingsContent — accordion toggle behavior', () => {
  it('clicking a collapsed sub-section header opens it', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    // All collapsed initially.
    expect(screen.queryByTestId('setting-theme')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('subheader-general-heading'));

    // General is now open.
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument();
    expect(screen.getByTestId('subheader-general-heading').getAttribute('aria-expanded')).toBe('true');
  });

  it('clicking the currently open sub-section header collapses it (none open)', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    // Open General.
    fireEvent.click(screen.getByTestId('subheader-general-heading'));
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument();

    // Click it again — should collapse.
    fireEvent.click(screen.getByTestId('subheader-general-heading'));
    expect(screen.queryByTestId('setting-theme')).not.toBeInTheDocument();
    expect(screen.getByTestId('subheader-general-heading').getAttribute('aria-expanded')).toBe('false');
  });

  it('opening a second sub-section closes the first (one at a time)', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    // Open General.
    fireEvent.click(screen.getByTestId('subheader-general-heading'));
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument();

    // Open Files — General should close.
    fireEvent.click(screen.getByTestId('subheader-files-heading'));
    expect(screen.getByTestId('setting-defaultNewFileType')).toBeInTheDocument();
    expect(screen.queryByTestId('setting-theme')).not.toBeInTheDocument();
  });
});

describe('SettingsContent — accordion resets on section switch', () => {
  it('switching top-level sections resets to all-collapsed', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    // Open a sub-section in workspace.
    fireEvent.click(screen.getByTestId('subheader-general-heading'));
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument();

    // Switch to AI & Privacy.
    fireEvent.click(screen.getByTestId('settings-category-ai-privacy'));
    expect(screen.getByTestId('section-ai-privacy')).toBeInTheDocument();

    // The AI sub-section headers should all be collapsed.
    expect(screen.getByTestId('subheader-ai-heading').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('subheader-memory-heading').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('subheader-privacy-heading').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('SettingsContent — search still expands matching sub-sections', () => {
  it('typing a query expands sub-sections that contain a match', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    // All collapsed initially.
    expect(screen.queryByTestId('setting-theme')).not.toBeInTheDocument();

    // Search for "theme" — it lives in the General sub-section.
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'theme' },
    });

    // The matching setting should now be visible.
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument();
  });
});

describe('SettingsContent — scroll resets on section change', () => {
  it('resets the content scroll container to top when the active section changes', () => {
    render(<SettingsContent variant="page" />);
    const scroller = screen.getByTestId('settings-content-scroll');

    // Simulate the user having scrolled down within the current section.
    scroller.scrollTop = 250;
    expect(scroller.scrollTop).toBe(250);

    // Switch to a different top-level section.
    fireEvent.click(screen.getByTestId('settings-category-account'));

    // The scroll-reset effect must have returned the container to the top.
    expect(scroller.scrollTop).toBe(0);
  });
});
