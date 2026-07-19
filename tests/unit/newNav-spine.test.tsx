import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('Spine — 3-tab shell', () => {

  it('renders exactly the 3 current primary tabs: Today, CRM, Ask (D11)', () => {
    render(<Spine activeTab="matters" />);
    expect(screen.getByTestId('spine-nav-home')).toBeTruthy();
    expect(screen.getByTestId('spine-nav-matters')).toBeTruthy();
    expect(screen.getByTestId('spine-nav-search')).toBeTruthy();
    expect(screen.queryByTestId('spine-nav-workflows')).toBeNull();
  });

  it('relabels the tabs (Today / CRM / Ask) while keeping internal ids', () => {
    render(<Spine activeTab="matters" />);
    expect(screen.getByTestId('spine-nav-home').textContent).toBe('Today');
    expect(screen.getByTestId('spine-nav-matters').textContent).toBe('CRM');
    expect(screen.getByTestId('spine-nav-search').textContent).toBe('Ask');
  });

  it('does NOT render the demoted surfaces as rail tabs (files/email/audit/privacy/settings)', () => {
    render(<Spine activeTab="matters" />);
    expect(screen.queryByTestId('spine-nav-files')).toBeNull();
    expect(screen.queryByTestId('spine-nav-email')).toBeNull();
    expect(screen.queryByTestId('spine-nav-audit')).toBeNull();
    expect(screen.queryByTestId('spine-nav-privacy')).toBeNull();
    expect(screen.queryByTestId('spine-nav-settings')).toBeNull();
    expect(screen.queryByTestId('spine-nav-workflows')).toBeNull();
  });

  it('still fires onTabChange with the internal id when a tab is clicked', () => {
    const onTabChange = vi.fn();
    render(<Spine activeTab="matters" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByTestId('spine-nav-search'));
    expect(onTabChange).toHaveBeenCalledWith('search');
  });

  it('exposes an add menu whose "New client" item opens the create flow', async () => {
    const spy = vi.fn();
    window.addEventListener('lantern:open-matter-manager', spy);
    render(<Spine activeTab="matters" />);
    // The rail plus is now a menu (New client / New group); open it, then pick
    // "New client".
    fireEvent.pointerDown(screen.getByTestId('spine-new-client'));
    fireEvent.click(await screen.findByTestId('spine-new-client-item'));
    expect(spy).toHaveBeenCalled();
    window.removeEventListener('lantern:open-matter-manager', spy);
  });

  it('collapsed mode shows the 3 primary tabs only', () => {
    render(<Spine activeTab="matters" collapsed />);
    expect(screen.getByTestId('spine-nav-collapsed-home')).toBeTruthy();
    expect(screen.getByTestId('spine-nav-collapsed-matters')).toBeTruthy();
    expect(screen.getByTestId('spine-nav-collapsed-search')).toBeTruthy();
    expect(screen.queryByTestId('spine-nav-collapsed-workflows')).toBeNull();
    expect(screen.queryByTestId('spine-nav-collapsed-settings')).toBeNull();
  });
});
