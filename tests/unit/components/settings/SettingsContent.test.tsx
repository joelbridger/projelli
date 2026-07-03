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

import { describe, it, expect, afterEach, vi } from 'vitest';
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

    // Footer keeps Export / Import; Reset to Defaults moved into the Advanced
    // section so a destructive, rarely-used action isn't a permanent
    // page-level control on every settings screen.
    expect(screen.getByTestId('settings-export')).toBeInTheDocument();
    expect(screen.getByTestId('settings-import')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-reset')).not.toBeInTheDocument();

    // No modal close X in page variant (that belongs to the dialog chrome).
    expect(screen.getByTestId('settings-content-scroll')).toBeInTheDocument();
  });

  it('shows Reset to Defaults only inside the Advanced section', () => {
    render(<SettingsContent variant="page" initialCategory="advanced" />);
    // The Advanced section itself is a tab strip; its "Advanced" sub-tab
    // (not "Extensions", the first/default one) holds the Reset control.
    fireEvent.click(screen.getByTestId('subheader-advanced-heading'));
    expect(screen.getByTestId('settings-reset')).toBeInTheDocument();
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

  // Wave B / S4: the page is flattened (all 5 sections always render), so
  // `section-X` presence no longer discriminates which one a deep-link
  // "landed on" — every section-X testid is always in the DOM. The nav
  // button's aria-current is what still meaningfully reflects the resolved
  // section (and is what the anchor-scroll effect keys off of).
  for (const [alias, sectionTestId] of cases) {
    const categoryId = sectionTestId.replace(/^section-/, '');
    it(`initialCategory="${alias}" lands on ${sectionTestId}`, () => {
      render(
        <SettingsContent variant="page" initialCategory={alias as never} />,
      );
      expect(screen.getByTestId(sectionTestId)).toBeInTheDocument();
      expect(screen.getByTestId(`settings-category-${categoryId}`).getAttribute('aria-current')).toBe('page');
    });
  }

  it('re-renders to a new section when initialCategory changes (deep-link update)', () => {
    const { rerender } = render(
      <SettingsContent variant="page" initialCategory={'general' as never} />,
    );
    expect(screen.getByTestId('settings-category-workspace').getAttribute('aria-current')).toBe('page');
    rerender(
      <SettingsContent variant="page" initialCategory={'ai' as never} />,
    );
    expect(screen.getByTestId('settings-category-ai-privacy').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('settings-category-workspace').hasAttribute('aria-current')).toBe(false);
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

describe('SettingsContent — nav scrolls to the section anchor (Wave B / S4 flatten)', () => {
  // The page flattened to one continuous scroll (all 5 sections render at
  // once); a nav click no longer switches mounted content, so "reset scroll
  // to top" no longer applies — it scrolls the clicked section's anchor into
  // view instead. jsdom doesn't implement layout/scrollIntoView, so this
  // verifies the call rather than an actual scroll position.
  it('scrolls to the target section anchor when a nav button is clicked', () => {
    render(<SettingsContent variant="page" />);
    const scrollIntoViewMock = vi.fn();
    const anchor = document.getElementById('settings-anchor-ai-privacy');
    expect(anchor).not.toBeNull();
    anchor!.scrollIntoView = scrollIntoViewMock;

    fireEvent.click(screen.getByTestId('settings-category-ai-privacy'));

    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it('all 5 section anchors are present at once (flattened, not switched)', () => {
    render(<SettingsContent variant="page" />);
    expect(screen.getByTestId('settings-anchor-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('settings-anchor-ai-privacy')).toBeInTheDocument();
    expect(screen.getByTestId('settings-anchor-voice')).toBeInTheDocument();
    expect(screen.getByTestId('settings-anchor-advanced')).toBeInTheDocument();
    expect(screen.getByTestId('settings-anchor-help')).toBeInTheDocument();
  });

  it('does NOT eagerly mount Advanced (and its Marketplace tab) when opening on Workspace (codex-review regression)', () => {
    // The flatten initially mounted all 5 sections unconditionally, so just
    // opening Settings on Workspace silently fired Advanced's default-tab
    // Marketplace refresh. Sections the user hasn't navigated to now render a
    // lazy placeholder instead of their real (possibly side-effecting) content.
    render(<SettingsContent variant="page" initialCategory={'general' as never} />);
    expect(screen.getByTestId('settings-anchor-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('section-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('settings-anchor-advanced')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('section-advanced')).not.toBeInTheDocument();

    // Clicking Advanced mounts it for real, Marketplace included (its default tab).
    fireEvent.click(screen.getByTestId('settings-category-advanced'));
    expect(screen.getByTestId('section-advanced')).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-tab')).toBeInTheDocument();
  });

  it('a search shows every matching section\'s real content, bypassing the lazy gate', () => {
    render(<SettingsContent variant="page" initialCategory={'general' as never} />);
    expect(screen.queryByTestId('section-advanced')).not.toBeInTheDocument();

    // "marketplace" matches an Advanced/Extensions keyword group.
    fireEvent.change(screen.getByTestId('settings-search'), { target: { value: 'marketplace' } });

    expect(screen.getByTestId('section-advanced')).toBeInTheDocument();
  });

  it('re-observes anchors that a search cycle unmounted and remounted (codex-review regression)', () => {
    // jsdom has no IntersectionObserver by default; stub one so the
    // scroll-to-load effect actually runs instead of early-returning.
    const observedNodes: Element[] = [];
    class FakeIntersectionObserver {
      observe(el: Element) { observedNodes.push(el); }
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    }
    const original = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver;

    try {
      render(<SettingsContent variant="page" initialCategory={'general' as never} />);
      const helpObservedBefore = observedNodes.filter((n) => n.id === 'settings-anchor-help').length;
      expect(helpObservedBefore).toBeGreaterThan(0);

      // A search that "help" doesn't match unmounts its anchor div entirely.
      fireEvent.change(screen.getByTestId('settings-search'), { target: { value: 'marketplace' } });
      expect(screen.queryByTestId('settings-anchor-help')).not.toBeInTheDocument();

      // Clearing the search remounts a FRESH anchor node for "help" — the
      // observer must have been re-created (not left watching the detached
      // one) to pick it up.
      observedNodes.length = 0;
      fireEvent.change(screen.getByTestId('settings-search'), { target: { value: '' } });
      const helpObservedAfter = observedNodes.filter((n) => n.id === 'settings-anchor-help').length;
      expect(helpObservedAfter).toBeGreaterThan(0);
    } finally {
      (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = original;
    }
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
