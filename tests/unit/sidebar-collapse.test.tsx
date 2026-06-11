// Component test — Sidebar collapse (F-509).
//
// Coverage:
//  - the root carries `shrink-0` so a wide sibling panel can never squeeze it
//    (the matching guard to `min-w-0` on the main panel, which is the primary
//    fix for "the workflow tab hides the sidebar")
//  - controlled `collapsed` reflects into the width class (`w-12` collapsed,
//    `w-64` expanded) instead of owning internal state
//  - the chevron button reports the toggle through `onCollapsedChange`
//    (false -> true) rather than mutating internal state, so the global Ctrl+B
//    shortcut and the chevron drive one source of truth
//  - uncontrolled (no `collapsed` prop) still toggles its own state

import type { ComponentProps } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { Sidebar } from '@/components/layout/Sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';

// The collapsed sidebar renders Radix tooltips on its tab icons, which need a
// TooltipProvider ancestor (mounted at App root in main.tsx). Wrap every render
// the same way so the collapsed-state assertions can mount.
function renderSidebar(props: ComponentProps<typeof Sidebar> = {}) {
  return render(
    <TooltipProvider>
      <Sidebar {...props} />
    </TooltipProvider>,
  );
}

function resetRegistry() {
  usePluginRegistryStore.setState({
    commands: new Map(),
    toolbar: [],
    sidebar: [],
    settingsPages: [],
  });
}

afterEach(() => {
  cleanup();
  resetRegistry();
});

describe('Sidebar collapse (F-509)', () => {
  it('carries shrink-0 on the root so a wide panel cannot squeeze it', () => {
    renderSidebar();
    const root = screen.getByTestId('sidebar');
    expect(root.className).toContain('shrink-0');
  });

  it('renders the collapsed width when controlled collapsed=true', () => {
    renderSidebar({ collapsed: true, onCollapsedChange: () => {} });
    const root = screen.getByTestId('sidebar');
    expect(root.className).toContain('w-12');
    expect(root.className).not.toContain('w-64');
  });

  it('renders the expanded width when controlled collapsed=false', () => {
    renderSidebar({ collapsed: false, onCollapsedChange: () => {} });
    const root = screen.getByTestId('sidebar');
    expect(root.className).toContain('w-64');
    expect(root.className).not.toContain('w-12');
  });

  it('reports the toggle through onCollapsedChange (false -> true) when controlled', () => {
    const onCollapsedChange = vi.fn();
    renderSidebar({ collapsed: false, onCollapsedChange });
    fireEvent.click(screen.getByTestId('sidebar-collapse-button'));
    expect(onCollapsedChange).toHaveBeenCalledTimes(1);
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    // Controlled: the component does not flip its own width — the parent owns it.
    expect(screen.getByTestId('sidebar').className).toContain('w-64');
  });

  it('toggles its own width when uncontrolled (no collapsed prop)', () => {
    renderSidebar();
    const root = screen.getByTestId('sidebar');
    expect(root.className).toContain('w-64');
    fireEvent.click(screen.getByTestId('sidebar-collapse-button'));
    expect(screen.getByTestId('sidebar').className).toContain('w-12');
  });
});
