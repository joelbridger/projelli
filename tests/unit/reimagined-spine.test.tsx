import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Spine } from '@/app/shell/layout/Spine';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useMatters: () => [],
  useActiveMatters: () => [],
  useActiveMatterId: () => null,
  useMatterStore: (selector: (s: { setActiveMatter: () => void }) => unknown) =>
    selector({ setActiveMatter: vi.fn() }),
}));
vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: (m: unknown) => String(m),
}));

describe('Spine', () => {
  it('does NOT contain an AI Assistant nav item', () => {
    render(<Spine />);
    // The nav should not contain an "AI Assistant" button
    const navEl = screen.queryByTestId('spine-nav');
    expect(navEl).toBeTruthy();
    // Check no button with ai-assistant label
    const buttons = screen.getAllByRole('button');
    const aiAssistantButton = buttons.find((btn) =>
      btn.textContent?.toLowerCase().includes('ai assistant') ||
      btn.getAttribute('title')?.toLowerCase().includes('ai assistant')
    );
    expect(aiAssistantButton).toBeUndefined();
  });

  it('renders without crashing with aiAssistantContent prop', () => {
    const content = <div data-testid="ai-content">AI Content</div>;
    expect(() => render(<Spine aiAssistantContent={content} />)).not.toThrow();
    // The prop is accepted (no TS error), but the content is not rendered in the nav tab
    expect(screen.queryByTestId('ai-content')).toBeNull();
  });

  it('renders spine nav without AI Assistant tab', () => {
    render(<Spine activeTab="matters" />);
    const nav = screen.getByTestId('spine-nav');
    expect(nav).toBeTruthy();
    // Verify it does not show AI Assistant label in nav buttons
    expect(nav.textContent).not.toMatch(/ai.?assistant/i);
  });

  it('shows the 3 primary nav items: Home, Clients, Ask', () => {
    render(<Spine />);
    const navEl = screen.getByTestId('spine-nav');
    expect(navEl).toBeTruthy();
    expect(screen.getByTestId('spine-nav-home')).toBeTruthy();
    expect(screen.getByTestId('spine-nav-matters')).toBeTruthy();
    expect(screen.getByTestId('spine-nav-search')).toBeTruthy();
    expect(screen.queryByTestId('spine-nav-workflows')).toBeNull();
  });

  it('renders without crashing with no props', () => {
    const { container } = render(<Spine />);
    expect(container.firstChild).toBeTruthy();
  });

  it('does NOT render the demoted surfaces (Documents/Email/Activity Log/Privacy/Settings) as rail tabs', () => {
    render(<Spine />);
    expect(screen.queryByTestId('spine-nav-files')).toBeNull();
    expect(screen.queryByTestId('spine-nav-email')).toBeNull();
    expect(screen.queryByTestId('spine-nav-audit')).toBeNull();
    expect(screen.queryByTestId('spine-nav-privacy')).toBeNull();
    expect(screen.queryByTestId('spine-nav-settings')).toBeNull();
  });
});
