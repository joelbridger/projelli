/**
 * SettingsContent — unit tests for the reusable Settings body (R62 / R71).
 *
 * SettingsContent is the inner surface shared by the quick <SettingsModal>
 * (Dialog) and the full-page "Settings" nav tab. These tests exercise it
 * directly (no Dialog), covering:
 *   - The full-page variant renders the SurfaceHeader + 5-section nav + content + footer.
 *   - Deep-link aliases still resolve to the right section through the
 *     modal→content extraction (e.g. "ai" → AI & Privacy, "general" → Workspace).
 *   - Tab strip: first sub-tab's content panel IS in the DOM; others are NOT.
 *   - Tab strip: clicking a non-active tab activates it; prior panel leaves the DOM.
 *   - Tab strip: switching top-level sections resets to that section's first tab.
 *   - Tab a11y: role="tab" and aria-selected on each tab button.
 *   - aria-current: the active section nav button has aria-current="page"; others
 *     have no aria-current attribute.
 *   - Scroll-reset: the content scroll container returns to top when the
 *     active top-level section changes.
 *   - Search: typing a query auto-selects the first matching tab (its panel appears).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SettingsContent } from '@/features/settings/SettingsContent';

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
    // account-related legacy ids fall back to workspace (App.tsx intercepts them
    // before Settings sees them, opening AccountWindow instead)
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
      <SettingsContent variant="page" initialCategory={'ai' as never} />,
    );
    expect(screen.getByTestId('section-ai-privacy')).toBeInTheDocument();
  });
});

describe('SettingsContent — aria-current on section nav buttons', () => {
  it('the active section nav button has aria-current="page"', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    const activeBtn = screen.getByTestId('settings-category-workspace');
    expect(activeBtn.getAttribute('aria-current')).toBe('page');
  });

  it('inactive section nav buttons have no aria-current attribute', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    const inactiveBtn = screen.getByTestId('settings-category-ai-privacy');
    expect(inactiveBtn.hasAttribute('aria-current')).toBe(false);
  });

  it('aria-current moves to the newly active section when clicking a nav button', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    // workspace is initially active
    expect(screen.getByTestId('settings-category-workspace').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('settings-category-ai-privacy').hasAttribute('aria-current')).toBe(false);

    // click AI & Privacy
    fireEvent.click(screen.getByTestId('settings-category-ai-privacy'));

    // now AI & Privacy is active, workspace is not
    expect(screen.getByTestId('settings-category-ai-privacy').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('settings-category-workspace').hasAttribute('aria-current')).toBe(false);
  });
});

describe('SettingsContent — tab strip default state', () => {
  it('first sub-tab (General) content panel IS in the DOM by default', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    // First tab in Workspace is General — its subsection-general panel should be present.
    expect(screen.getByTestId('subsection-general')).toBeInTheDocument();
  });

  it('non-first sub-tab (Editor) content panel is NOT in the DOM by default', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    // Editor is the second tab — it starts inactive and its panel is unmounted.
    expect(screen.queryByTestId('subsection-editor')).not.toBeInTheDocument();
  });

  it('non-first sub-tab (Files) content panel is NOT in the DOM by default', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    expect(screen.queryByTestId('subsection-files')).not.toBeInTheDocument();
  });
});

describe('SettingsContent — tab strip aria attributes', () => {
  it('first tab (General) has aria-selected="true"; others have aria-selected="false"', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    const generalBtn = screen.getByTestId('subheader-general-heading');
    const editorBtn = screen.getByTestId('subheader-editor-heading');
    const filesBtn = screen.getByTestId('subheader-files-heading');
    expect(generalBtn.getAttribute('aria-selected')).toBe('true');
    expect(editorBtn.getAttribute('aria-selected')).toBe('false');
    expect(filesBtn.getAttribute('aria-selected')).toBe('false');
  });

  it('all sub-section tab buttons have role="tab"', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    const generalBtn = screen.getByTestId('subheader-general-heading');
    const editorBtn = screen.getByTestId('subheader-editor-heading');
    const filesBtn = screen.getByTestId('subheader-files-heading');
    expect(generalBtn.getAttribute('role')).toBe('tab');
    expect(editorBtn.getAttribute('role')).toBe('tab');
    expect(filesBtn.getAttribute('role')).toBe('tab');
  });
});

describe('SettingsContent — tab strip click behavior', () => {
  it('clicking the Editor tab activates it: subsection-editor appears, subsection-general disappears', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    // General is active by default.
    expect(screen.getByTestId('subsection-general')).toBeInTheDocument();
    expect(screen.queryByTestId('subsection-editor')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('subheader-editor-heading'));

    // Editor now active.
    expect(screen.getByTestId('subsection-editor')).toBeInTheDocument();
    // General now inactive and removed from DOM.
    expect(screen.queryByTestId('subsection-general')).not.toBeInTheDocument();
    // Editor tab is now aria-selected=true.
    expect(screen.getByTestId('subheader-editor-heading').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('subheader-general-heading').getAttribute('aria-selected')).toBe('false');
  });

  it('clicking the Files tab makes it active; setting-defaultNewFileType appears', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    fireEvent.click(screen.getByTestId('subheader-files-heading'));

    // Files panel is now in the DOM.
    expect(screen.getByTestId('subsection-files')).toBeInTheDocument();
    expect(screen.getByTestId('setting-defaultNewFileType')).toBeInTheDocument();
    // General panel is gone.
    expect(screen.queryByTestId('subsection-general')).not.toBeInTheDocument();
  });
});

describe('SettingsContent — tab strip resets on section switch', () => {
  it('switching top-level sections resets to the new section\'s first tab', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    // Click Editor tab in Workspace.
    fireEvent.click(screen.getByTestId('subheader-editor-heading'));
    expect(screen.getByTestId('subsection-editor')).toBeInTheDocument();

    // Switch to AI & Privacy.
    fireEvent.click(screen.getByTestId('settings-category-ai-privacy'));
    expect(screen.getByTestId('section-ai-privacy')).toBeInTheDocument();

    // The first tab in AI & Privacy (AI) should be active.
    expect(screen.getByTestId('subheader-ai-heading').getAttribute('aria-selected')).toBe('true');
    // Its content panel should be in the DOM.
    expect(screen.getByTestId('subsection-ai')).toBeInTheDocument();
    // The second and third tabs (Memory, Privacy) should not have their panels in the DOM.
    expect(screen.queryByTestId('subsection-memory')).not.toBeInTheDocument();
    expect(screen.queryByTestId('subsection-privacy')).not.toBeInTheDocument();
  });
});

describe('SettingsContent — search auto-selects matching tab', () => {
  it('typing a query that matches a non-first sub-section auto-selects that tab', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    // Editor is not the active tab by default (General is first).
    expect(screen.queryByTestId('subsection-editor')).not.toBeInTheDocument();

    // Search for "auto save" — it lives in the Editor sub-section (non-first).
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'auto save' },
    });

    // The Editor tab's content panel should now be in the DOM (auto-selected by search).
    expect(screen.getByTestId('subsection-editor')).toBeInTheDocument();
    expect(screen.getByTestId('setting-autoSave')).toBeInTheDocument();
  });

  it('typing a query matching the first sub-section keeps its panel in the DOM', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    // General is active by default; search for "theme" (in General).
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'theme' },
    });

    // The matching setting should be accessible.
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument();
    expect(screen.getByTestId('subsection-general')).toBeInTheDocument();
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
    fireEvent.click(screen.getByTestId('settings-category-ai-privacy'));

    // The scroll-reset effect must have returned the container to the top.
    expect(scroller.scrollTop).toBe(0);
  });
});

describe('SettingsContent — a11y: section nav landmark label', () => {
  it('the settings section nav has aria-label="Settings sections"', () => {
    render(<SettingsContent variant="page" />);
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(nav).toBeInTheDocument();
  });
});

describe('SettingsContent — a11y: tab strip role and aria-selected', () => {
  it('the tab container has role="tablist"', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    const tablist = screen.getAllByRole('tablist');
    // At least one tablist renders for the active section.
    expect(tablist.length).toBeGreaterThan(0);
  });

  it('switching tabs updates aria-selected correctly', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    const generalBtn = screen.getByTestId('subheader-general-heading');
    const editorBtn = screen.getByTestId('subheader-editor-heading');

    // General starts active.
    expect(generalBtn.getAttribute('aria-selected')).toBe('true');
    expect(editorBtn.getAttribute('aria-selected')).toBe('false');

    // Click Editor.
    fireEvent.click(editorBtn);
    expect(editorBtn.getAttribute('aria-selected')).toBe('true');
    expect(generalBtn.getAttribute('aria-selected')).toBe('false');
  });
});
