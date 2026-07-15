import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SettingsContent } from '@/features/settings/SettingsContent';
import { setDevFlagOverride } from '@/platform/flags';

afterEach(() => {
  setDevFlagOverride('teams-roles', undefined);
  cleanup();
});

function settingsNavButtons() {
  return screen
    .getAllByRole('button')
    .filter((b) => (b.getAttribute('data-testid') ?? '').startsWith('settings-category-'));
}

describe('SettingsContent', () => {
  it('renders the page header, seven left-rail sections, content area, and actions menu', () => {
    render(<SettingsContent variant="page" />);

    expect(screen.getByTestId('settings-content')).toHaveAttribute('data-variant', 'page');
    expect(screen.getByTestId('settings-surface-header')).toBeInTheDocument();
    expect(settingsNavButtons()).toHaveLength(7);
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
    ['scheduling', 'section-scheduling'],
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

  it('keeps startup visible, hides only the retired tab control, and keeps useful file hints visible', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    expect(screen.getByTestId('setting-startupBehavior')).toHaveTextContent('On startup');
    expect(screen.getByTestId('setting-startupBehavior')).toHaveTextContent('Reopen where you left off');
    expect(screen.queryByTestId('setting-tabOverflow')).not.toBeInTheDocument();
    expect(screen.getByTestId('setting-autoSaveInterval')).toHaveTextContent('seconds');
    expect(screen.getByTestId('setting-letterheadTemplatePath')).toHaveTextContent('Firm Letterhead.docx');
    expect(screen.getByTestId('setting-showHiddenFiles')).toHaveTextContent('.lantern');
  });

  it('keeps AI rules visible but disabled until a workspace is open', () => {
    render(
      <SettingsContent
        variant="page"
        initialCategory={'ai' as never}
        hasWorkspaceOpen={false}
      />,
    );

    expect(screen.getByTestId('setting-manageAIRules')).toHaveTextContent('AI rules');
    expect(screen.getByTestId('setting-manageAIRules')).toHaveTextContent(
      'Opens ai-rules.md — standing instructions the AI follows in every chat.'
    );
    expect(screen.getByRole('button', { name: 'Manage AI rules' })).toBeDisabled();
    expect(screen.getByText('Open a workspace first')).toBeInTheDocument();
  });

  it('renders voice hotkeys as read-only values instead of blank rows', () => {
    render(<SettingsContent variant="page" initialCategory={'voice' as never} />);

    expect(screen.getByTestId('setting-voicePressToTalkShortcut')).toHaveTextContent('Ctrl+Shift+Space');
    expect(screen.getByTestId('setting-voiceNoteShortcut')).toHaveTextContent('Ctrl+Shift+N');
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

  it('search can find startup by the visible reopen wording', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    fireEvent.click(screen.getByTestId('settings-search-toggle'));
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'reopen where you left off' },
    });

    expect(screen.getByTestId('setting-startupBehavior')).toBeInTheDocument();
  });

  it('search does not expose the retired tab overflow setting', () => {
    render(<SettingsContent variant="page" initialCategory={'workspace' as never} />);

    fireEvent.click(screen.getByTestId('settings-search-toggle'));
    fireEvent.change(screen.getByTestId('settings-search'), {
      target: { value: 'wrap to multiple rows' },
    });

    expect(screen.queryByTestId('setting-tabOverflow')).not.toBeInTheDocument();
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

  it('updates the rail when a panel flag changes while Settings is open', async () => {
    setDevFlagOverride('teams-roles', false);
    render(<SettingsContent variant="page" />);
    expect(screen.queryByTestId('settings-category-organization')).not.toBeInTheDocument();

    setDevFlagOverride('teams-roles', true);
    await waitFor(() => {
      expect(screen.getByTestId('settings-category-organization')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('settings-category-organization'));

    setDevFlagOverride('teams-roles', false);
    await waitFor(() => {
      expect(screen.queryByTestId('settings-category-organization')).not.toBeInTheDocument();
      expect(screen.getByTestId('settings-category-workspace')).toHaveAttribute('aria-current', 'page');
      expect(screen.getByTestId('section-workspace')).toBeInTheDocument();
    });
  });
});
