import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SettingsContent } from '@/features/settings/SettingsContent';

afterEach(() => {
  cleanup();
});

function settingsNavButtons() {
  return screen
    .getAllByRole('button')
    .filter((b) => (b.getAttribute('data-testid') ?? '').startsWith('settings-category-'));
}

describe('SettingsContent', () => {
  it('renders the page header, six left-rail sections, content area, and actions menu', () => {
    render(<SettingsContent variant="page" />);

    expect(screen.getByTestId('settings-content')).toHaveAttribute('data-variant', 'page');
    expect(screen.getByTestId('settings-surface-header')).toBeInTheDocument();
    expect(settingsNavButtons()).toHaveLength(6);
    expect(screen.getByTestId('settings-content-scroll')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByTestId('settings-actions-menu'), { button: 0, ctrlKey: false });
    expect(screen.getByTestId('settings-export')).toHaveTextContent('Export settings');
    expect(screen.getByTestId('settings-import')).toHaveTextContent('Import settings');
    expect(screen.getByTestId('settings-reset')).toHaveTextContent('Reset settings...');
  });

  it.each([
    ['general', 'section-workspace'],
    ['editor', 'section-workspace'],
    ['files', 'section-workspace'],
    ['ai', 'section-ai'],
    ['memory', 'section-ai'],
    ['ai-privacy', 'section-ai'],
    ['privacy', 'section-privacy'],
    ['voice', 'section-voice'],
    ['shortcuts', 'section-help'],
    ['marketplace', 'section-advanced'],
    ['updates', 'section-advanced'],
    ['about', 'section-help'],
  ])('initialCategory="%s" lands on %s', (alias, sectionTestId) => {
    render(<SettingsContent variant="page" initialCategory={alias as never} />);
    expect(screen.getByTestId(sectionTestId)).toBeInTheDocument();
  });

  it('re-renders to a new section when initialCategory changes', () => {
    const { rerender } = render(
      <SettingsContent variant="page" initialCategory={'general' as never} />,
    );
    expect(screen.getByTestId('section-workspace')).toBeInTheDocument();

    rerender(<SettingsContent variant="page" initialCategory={'privacy' as never} />);
    expect(screen.getByTestId('section-privacy')).toBeInTheDocument();
  });

  it('moves aria-current when the user clicks a left-rail section', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    expect(screen.getByTestId('settings-category-workspace')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('settings-category-ai')).not.toHaveAttribute('aria-current');

    fireEvent.click(screen.getByTestId('settings-category-ai'));

    expect(screen.getByTestId('settings-category-ai')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('settings-category-workspace')).not.toHaveAttribute('aria-current');
  });

  it('shows all groups in a section as plain headings, not tabs', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    expect(screen.getByTestId('subsection-general')).toBeInTheDocument();
    expect(screen.getByTestId('subsection-editor')).toBeInTheDocument();
    expect(screen.getByTestId('subsection-files')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByTestId('subheader-files')).toHaveTextContent('Files');
  });

  it('search shows the matching group and keeps the matching setting reachable', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    fireEvent.click(screen.getByTestId('settings-search-toggle'));
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'auto save' },
    });

    expect(screen.getByTestId('subsection-editor')).toBeInTheDocument();
    expect(screen.getByTestId('setting-autoSave')).toBeInTheDocument();
    expect(screen.queryByTestId('subsection-general')).not.toBeInTheDocument();
  });

  it('theme search does not expose a user-facing theme setting', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    fireEvent.click(screen.getByTestId('settings-search-toggle'));
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'theme' },
    });

    expect(screen.queryByTestId('setting-theme')).not.toBeInTheDocument();
  });

  it('resets the content scroll container to top when the active section changes', () => {
    render(<SettingsContent variant="page" />);
    const scroller = screen.getByTestId('settings-content-scroll');

    scroller.scrollTop = 250;
    expect(scroller.scrollTop).toBe(250);

    fireEvent.click(screen.getByTestId('settings-category-ai'));

    expect(scroller.scrollTop).toBe(0);
  });

  it('keeps the settings navigation landmark label', () => {
    render(<SettingsContent variant="page" />);
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
  });
});
