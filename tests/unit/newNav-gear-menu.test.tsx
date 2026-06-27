import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GearMenu } from '@/app/shell/layout/GearMenu';

describe('GearMenu (newNav)', () => {
  function setup() {
    const handlers = {
      onOpenSettings: vi.fn(),
      onOpenPrivacy: vi.fn(),
      onOpenActivity: vi.fn(),
      onOpenEmail: vi.fn(),
      onOpenDocuments: vi.fn(),
    };
    render(<GearMenu {...handlers} />);
    return handlers;
  }

  it('renders the gear trigger with the stable settings-gear testid', () => {
    setup();
    expect(screen.getByTestId('settings-gear')).toBeTruthy();
  });

  it('is closed initially (menu items hidden)', () => {
    setup();
    expect(screen.queryByTestId('spine-nav-privacy')).toBeNull();
  });

  it('opens on gear click and shows Settings / Privacy / Activity / Email / Documents', () => {
    setup();
    fireEvent.click(screen.getByTestId('settings-gear'));
    expect(screen.getByTestId('gear-menu-settings')).toBeTruthy();
    expect(screen.getByTestId('spine-nav-privacy')).toBeTruthy();
    expect(screen.getByTestId('spine-nav-audit')).toBeTruthy();
    expect(screen.getByTestId('spine-nav-email')).toBeTruthy();
    expect(screen.getByTestId('spine-nav-files')).toBeTruthy();
  });

  it('Email item triggers onOpenEmail (inbox demoted, not deleted)', () => {
    const h = setup();
    fireEvent.click(screen.getByTestId('settings-gear'));
    fireEvent.click(screen.getByTestId('spine-nav-email'));
    expect(h.onOpenEmail).toHaveBeenCalledTimes(1);
  });

  it('focuses the first item on open and moves focus with ArrowDown', () => {
    setup();
    fireEvent.click(screen.getByTestId('settings-gear'));
    expect(document.activeElement).toBe(screen.getByTestId('gear-menu-settings'));
    fireEvent.keyDown(screen.getByTestId('gear-menu-settings'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('spine-nav-privacy'));
  });

  it('routes each item to its handler and closes', () => {
    const h = setup();
    fireEvent.click(screen.getByTestId('settings-gear'));
    fireEvent.click(screen.getByTestId('spine-nav-privacy'));
    expect(h.onOpenPrivacy).toHaveBeenCalledTimes(1);
    // menu closed after selecting
    expect(screen.queryByTestId('spine-nav-privacy')).toBeNull();
  });

  it('Settings item triggers onOpenSettings', () => {
    const h = setup();
    fireEvent.click(screen.getByTestId('settings-gear'));
    fireEvent.click(screen.getByTestId('gear-menu-settings'));
    expect(h.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('Documents item triggers onOpenDocuments (Word/files reachable in new shell)', () => {
    const h = setup();
    fireEvent.click(screen.getByTestId('settings-gear'));
    fireEvent.click(screen.getByTestId('spine-nav-files'));
    expect(h.onOpenDocuments).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    setup();
    fireEvent.click(screen.getByTestId('settings-gear'));
    expect(screen.getByTestId('spine-nav-privacy')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('spine-nav-privacy')).toBeNull();
  });
});
