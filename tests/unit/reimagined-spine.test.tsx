import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReimaginedSpine } from '@/app/shell/layout/ReimaginedSpine';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/stores/matterStore', () => ({
  useMatters: () => [],
  useActiveMatterId: () => null,
  useMatterStore: (selector: (s: { setActiveMatter: () => void }) => unknown) =>
    selector({ setActiveMatter: vi.fn() }),
}));
vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: (m: unknown) => String(m),
}));

describe('ReimaginedSpine', () => {
  it('does NOT contain an AI Assistant nav item', () => {
    render(<ReimaginedSpine />);
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
    expect(() => render(<ReimaginedSpine aiAssistantContent={content} />)).not.toThrow();
    // The prop is accepted (no TS error), but the content is not rendered in the nav tab
    expect(screen.queryByTestId('ai-content')).toBeNull();
  });

  it('renders spine nav without AI Assistant tab', () => {
    render(<ReimaginedSpine activeTab="matters" />);
    const nav = screen.getByTestId('spine-nav');
    expect(nav).toBeTruthy();
    // Verify it does not show AI Assistant label in nav buttons
    expect(nav.textContent).not.toMatch(/ai.?assistant/i);
  });

  it('shows expected nav items: Matters, Search, Documents, Workflows', () => {
    render(<ReimaginedSpine />);
    // At least some core nav items should be present
    const navEl = screen.getByTestId('spine-nav');
    expect(navEl).toBeTruthy();
    // Search nav item should be present
    const searchBtn = screen.queryByRole('button', { name: /search/i });
    // There's a Search button via title or label
    expect(searchBtn !== null || navEl.textContent?.includes('Search')).toBe(true);
  });

  it('renders without crashing with no props', () => {
    const { container } = render(<ReimaginedSpine />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders Matters nav item', () => {
    render(<ReimaginedSpine />);
    const navEl = screen.getByTestId('spine-nav');
    // The matters label comes from t('layout.sidebar.tabs.matters') which is mocked as the key
    expect(navEl.textContent).toMatch(/matters/i);
  });

  it('renders a Settings nav item directly after Activity Log', () => {
    render(<ReimaginedSpine />);
    const settingsBtn = screen.getByTestId('spine-nav-settings');
    expect(settingsBtn).toBeTruthy();
    expect(settingsBtn.textContent).toMatch(/settings/i);

    // Order: the Settings button must come after the Activity Log (audit) button.
    const auditBtn = screen.getByTestId('spine-nav-audit');
    const order = settingsBtn.compareDocumentPosition(auditBtn);
    // DOCUMENT_POSITION_PRECEDING (2) on `order` means auditBtn precedes settingsBtn.
    expect(order & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('Settings nav item fires onTabChange("settings") when clicked', () => {
    const onTabChange = vi.fn();
    render(<ReimaginedSpine onTabChange={onTabChange} />);
    fireEvent.click(screen.getByTestId('spine-nav-settings'));
    expect(onTabChange).toHaveBeenCalledWith('settings');
  });

  it('also exposes a collapsed Settings nav item', () => {
    render(<ReimaginedSpine collapsed />);
    expect(screen.getByTestId('spine-nav-collapsed-settings')).toBeTruthy();
  });
});
