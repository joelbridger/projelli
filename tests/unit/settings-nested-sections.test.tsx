/**
 * SettingsContent — nested extra sections (newNav).
 *
 * In the 3-tab IA the gear opens the Settings screen, and Privacy Center +
 * Activity Log live as normal items in that screen's left nav. They are
 * passed in via the `extraSections` prop (so SettingsContent stays decoupled
 * from those surfaces' data wiring). When the prop is omitted — the default /
 * flag-off path — the Settings screen shows only the standard sections.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SettingsContent } from '@/features/settings/SettingsContent';

afterEach(() => { cleanup(); });

const extraSections = [
  {
    id: 'privacy-center',
    label: 'Privacy Center',
    testid: 'settings-category-privacy-center',
    content: <div data-testid="nested-privacy">NESTED PRIVACY CONTENT</div>,
  },
  {
    id: 'activity-log',
    label: 'Activity Log',
    testid: 'settings-category-activity-log',
    content: <div data-testid="nested-activity">NESTED ACTIVITY CONTENT</div>,
  },
];

describe('SettingsContent — nested extra sections (newNav)', () => {
  it('renders the extra section nav buttons alongside the 7 standard sections', () => {
    render(<SettingsContent variant="page" extraSections={extraSections} />);
    expect(screen.getByTestId('settings-category-privacy-center')).toBeInTheDocument();
    expect(screen.getByTestId('settings-category-activity-log')).toBeInTheDocument();
    // The standard settings sections are still present.
    expect(screen.getByTestId('settings-category-workspace')).toBeInTheDocument();
  });

  it('clicking an extra section shows its content and hides the settings body', () => {
    render(<SettingsContent variant="page" extraSections={extraSections} />);
    // By default a real settings section (Workspace) is shown; nested content is not.
    expect(screen.getByTestId('section-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('nested-privacy')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('settings-category-privacy-center'));

    expect(screen.getByTestId('nested-privacy')).toBeInTheDocument();
    expect(screen.queryByTestId('section-workspace')).not.toBeInTheDocument();
  });

  it('marks the active extra section with aria-current and returns to settings on click-back', () => {
    render(<SettingsContent variant="page" extraSections={extraSections} />);

    fireEvent.click(screen.getByTestId('settings-category-activity-log'));
    expect(screen.getByTestId('nested-activity')).toBeInTheDocument();
    expect(screen.getByTestId('settings-category-activity-log').getAttribute('aria-current')).toBe('page');
    // The settings section buttons lose aria-current while an extra is active.
    expect(screen.getByTestId('settings-category-workspace').hasAttribute('aria-current')).toBe(false);

    // Clicking a real settings section returns to it and clears the extra view.
    fireEvent.click(screen.getByTestId('settings-category-workspace'));
    expect(screen.getByTestId('section-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('nested-activity')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings-category-workspace').getAttribute('aria-current')).toBe('page');
  });

  it('without extraSections, only the 7 standard sections render', () => {
    render(<SettingsContent variant="page" />);
    const navBtns = screen
      .getAllByRole('button')
      .filter((b) => (b.getAttribute('data-testid') ?? '').startsWith('settings-category-'));
    expect(navBtns).toHaveLength(7);
    expect(screen.queryByTestId('settings-category-privacy-center')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-category-activity-log')).not.toBeInTheDocument();
  });
});
