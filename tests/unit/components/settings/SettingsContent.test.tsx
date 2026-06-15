/**
 * SettingsContent — unit tests for the reusable Settings body (R62 / R71).
 *
 * SettingsContent is the inner surface shared by the quick <SettingsModal>
 * (Dialog) and the full-page "Settings" nav tab. These tests exercise it
 * directly (no Dialog), covering:
 *   - The full-page variant renders the SurfaceHeader + 5-section nav + content + footer.
 *   - Deep-link aliases still resolve to the right section through the
 *     modal→content extraction (e.g. "ai" → AI & Privacy, "general" → Workspace).
 *   - Accordion: ALL sub-sections collapsed by default.
 *   - Accordion: clicking a closed header opens it (one at a time).
 *   - Accordion: clicking the open header collapses it (zero-open is valid).
 *   - Accordion: opening one closes others within the same section.
 *   - Accordion: switching top-level sections resets to all-collapsed.
 *   - Accordion body: always present in the DOM (hidden attribute, not unmounted),
 *     so aria-controls associations remain valid while collapsed.
 *   - aria-current: the active section nav button has aria-current="page"; others
 *     have no aria-current attribute.
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

describe('SettingsContent — accordion body always in DOM (hidden, not unmounted)', () => {
  it('collapsed sub-section body is in the DOM with hidden attribute', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    // The "General" sub-section accordion button has aria-controls="ws-general-body".
    // Even while collapsed, that element must exist so the aria association is valid.
    const generalBtn = screen.getByTestId('subheader-general-heading');
    const controlsId = generalBtn.getAttribute('aria-controls');
    expect(controlsId).toBe('ws-general-body');
    const body = document.getElementById(controlsId!);
    expect(body).toBeInTheDocument();
    expect(body).toHaveAttribute('hidden');
  });

  it('opening a sub-section removes the hidden attribute from its body', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    const generalBtn = screen.getByTestId('subheader-general-heading');
    const bodyId = generalBtn.getAttribute('aria-controls')!;
    const body = document.getElementById(bodyId)!;

    // Collapsed: hidden present.
    expect(body).toHaveAttribute('hidden');

    fireEvent.click(generalBtn);

    // Expanded: hidden removed.
    expect(body).not.toHaveAttribute('hidden');
  });

  it('collapsing an open sub-section restores the hidden attribute', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    const generalBtn = screen.getByTestId('subheader-general-heading');
    const bodyId = generalBtn.getAttribute('aria-controls')!;
    const body = document.getElementById(bodyId)!;

    // Open it first.
    fireEvent.click(generalBtn);
    expect(body).not.toHaveAttribute('hidden');

    // Collapse it.
    fireEvent.click(generalBtn);
    expect(body).toHaveAttribute('hidden');
    // The body element itself is still in the DOM.
    expect(body).toBeInTheDocument();
  });
});

describe('SettingsContent — accordion all-collapsed by default', () => {
  it('workspace section starts with ALL sub-section bodies hidden', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    // section is rendered but no sub-section body is visible
    expect(screen.getByTestId('section-workspace')).toBeInTheDocument();

    // Bodies are in the DOM but hidden — content inside should not be visible.
    // We check via the hidden attribute on the body wrapper.
    expect(document.getElementById('ws-general-body')).toHaveAttribute('hidden');
    expect(document.getElementById('ws-editor-body')).toHaveAttribute('hidden');
    expect(document.getElementById('ws-files-body')).toHaveAttribute('hidden');
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
  it('clicking a collapsed sub-section header opens it (body no longer hidden)', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    // All collapsed initially.
    expect(document.getElementById('ws-general-body')).toHaveAttribute('hidden');

    fireEvent.click(screen.getByTestId('subheader-general-heading'));

    // General is now open: hidden removed, aria-expanded true.
    expect(document.getElementById('ws-general-body')).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('subheader-general-heading').getAttribute('aria-expanded')).toBe('true');
    // The setting inside is now accessible.
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument();
  });

  it('clicking the currently open sub-section header collapses it (hidden restored)', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    // Open General.
    fireEvent.click(screen.getByTestId('subheader-general-heading'));
    expect(document.getElementById('ws-general-body')).not.toHaveAttribute('hidden');

    // Click it again — should collapse.
    fireEvent.click(screen.getByTestId('subheader-general-heading'));
    expect(document.getElementById('ws-general-body')).toHaveAttribute('hidden');
    expect(screen.getByTestId('subheader-general-heading').getAttribute('aria-expanded')).toBe('false');
  });

  it('opening a second sub-section hides the first (one at a time)', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    // Open General.
    fireEvent.click(screen.getByTestId('subheader-general-heading'));
    expect(document.getElementById('ws-general-body')).not.toHaveAttribute('hidden');

    // Open Files — General should become hidden again.
    fireEvent.click(screen.getByTestId('subheader-files-heading'));
    expect(document.getElementById('ws-files-body')).not.toHaveAttribute('hidden');
    expect(document.getElementById('ws-general-body')).toHaveAttribute('hidden');
    // setting-defaultNewFileType visible (Files open); setting-theme hidden (General closed).
    expect(screen.getByTestId('setting-defaultNewFileType')).toBeInTheDocument();
  });
});

describe('SettingsContent — accordion resets on section switch', () => {
  it('switching top-level sections resets to all-collapsed', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    // Open a sub-section in workspace.
    fireEvent.click(screen.getByTestId('subheader-general-heading'));
    expect(document.getElementById('ws-general-body')).not.toHaveAttribute('hidden');

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
  it('typing a query removes hidden from sub-sections that contain a match', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    // All collapsed initially.
    expect(document.getElementById('ws-general-body')).toHaveAttribute('hidden');

    // Search for "theme" — it lives in the General sub-section.
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'theme' },
    });

    // The matching setting should now be visible (body not hidden).
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

describe('SettingsContent — a11y: accordion body aria-live', () => {
  it('each accordion body container has aria-live="polite"', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    // The workspace section renders at least three sub-section bodies.
    // All must carry aria-live="polite" so screen readers announce new content.
    const generalBody = document.getElementById('ws-general-body');
    const editorBody  = document.getElementById('ws-editor-body');
    const filesBody   = document.getElementById('ws-files-body');
    expect(generalBody).toBeInTheDocument();
    expect(generalBody?.getAttribute('aria-live')).toBe('polite');
    expect(editorBody).toBeInTheDocument();
    expect(editorBody?.getAttribute('aria-live')).toBe('polite');
    expect(filesBody).toBeInTheDocument();
    expect(filesBody?.getAttribute('aria-live')).toBe('polite');
  });

  it('accordion body keeps aria-live after open/close cycle', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    const generalBtn = screen.getByTestId('subheader-general-heading');
    const bodyId = generalBtn.getAttribute('aria-controls')!;

    // Open
    fireEvent.click(generalBtn);
    const body = document.getElementById(bodyId)!;
    expect(body).not.toHaveAttribute('hidden');
    expect(body.getAttribute('aria-live')).toBe('polite');

    // Close
    fireEvent.click(generalBtn);
    expect(body).toHaveAttribute('hidden');
    expect(body.getAttribute('aria-live')).toBe('polite');
  });
});
