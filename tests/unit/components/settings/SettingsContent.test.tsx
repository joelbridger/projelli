/**
 * SettingsContent — unit tests for the reusable Settings body (R62).
 *
 * SettingsContent is the inner surface shared by the quick <SettingsModal>
 * (Dialog) and the full-page "Settings" nav tab. These tests exercise it
 * directly (no Dialog), covering:
 *   - The full-page variant renders the 5-section nav + content + footer.
 *   - Deep-link aliases still resolve to the right section through the
 *     modal→content extraction (e.g. "ai" → AI & Privacy, "integrations" →
 *     Account).
 *   - Accordion: first sub-section open, the rest collapsed.
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
  it('renders the 5-section nav, content area, and footer (page variant)', () => {
    render(<SettingsContent variant="page" />);
    // The shared content marker is present and tagged as the page variant.
    const content = screen.getByTestId('settings-content');
    expect(content).toBeInTheDocument();
    expect(content.getAttribute('data-variant')).toBe('page');

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

  it('default section (workspace) shows its first sub-section open', () => {
    render(<SettingsContent variant="page" />);
    expect(screen.getByTestId('section-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument(); // General (first) open
    expect(screen.queryByTestId('setting-autoSave')).not.toBeInTheDocument(); // Editor collapsed
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

describe('SettingsContent — accordion one-open-at-a-time', () => {
  it('opening a second sub-section closes the first', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);
    expect(screen.getByTestId('setting-theme')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('subheader-files-heading'));
    expect(screen.getByTestId('setting-defaultNewFileType')).toBeInTheDocument();
    expect(screen.queryByTestId('setting-theme')).not.toBeInTheDocument();
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
