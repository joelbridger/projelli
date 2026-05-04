import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PluginPermissionsList } from '@/components/marketplace/PluginPermissionsList';
import type { PluginPermission } from '@/types/plugin';

const ALL_PERMISSIONS: PluginPermission[] = [
  'workspace:read',
  'workspace:write',
  'editor:selection',
  'editor:write',
  'ai:invoke',
  'network',
];

const EXPECTED_LABELS: Record<PluginPermission, string> = {
  'workspace:read': 'Read your files',
  'workspace:write': 'Modify your files',
  'editor:selection': 'Read your current text selection',
  'editor:write': 'Insert or replace text in your editor',
  'ai:invoke': 'Send prompts to your AI provider',
  network: 'Make network requests',
};

const EXPECTED_RISK: Record<PluginPermission, 'low' | 'medium'> = {
  'workspace:read': 'low',
  'workspace:write': 'medium',
  'editor:selection': 'low',
  'editor:write': 'low',
  'ai:invoke': 'medium',
  network: 'medium',
};

describe('PluginPermissionsList', () => {
  afterEach(() => cleanup());

  it('renders an empty-state when permissions array is empty', () => {
    render(<PluginPermissionsList permissions={[]} />);
    expect(
      screen.getByTestId('plugin-permissions-list-empty'),
    ).toHaveTextContent('no special permissions');
  });

  it('renders a list item for each permission with a label', () => {
    render(<PluginPermissionsList permissions={ALL_PERMISSIONS} />);
    expect(screen.getByTestId('plugin-permissions-list')).toBeInTheDocument();
    for (const p of ALL_PERMISSIONS) {
      const item = screen.getByTestId(`plugin-permission-${p}`);
      expect(item).toBeInTheDocument();
      expect(item).toHaveTextContent(EXPECTED_LABELS[p]);
    }
  });

  it('tags each permission with the correct risk level', () => {
    render(<PluginPermissionsList permissions={ALL_PERMISSIONS} />);
    for (const p of ALL_PERMISSIONS) {
      const item = screen.getByTestId(`plugin-permission-${p}`);
      expect(item.getAttribute('data-risk')).toBe(EXPECTED_RISK[p]);
      const riskBadge = screen.getByTestId(`plugin-permission-${p}-risk`);
      const expectedCopy =
        EXPECTED_RISK[p] === 'medium' ? 'Medium risk' : 'Low risk';
      expect(riskBadge).toHaveTextContent(expectedCopy);
    }
  });

  it('renders a billing note for ai:invoke', () => {
    render(<PluginPermissionsList permissions={['ai:invoke']} />);
    const note = screen.getByTestId('plugin-permission-ai:invoke-note');
    expect(note).toHaveTextContent('AI bill');
  });

  it('renders an exfiltration note for network', () => {
    render(<PluginPermissionsList permissions={['network']} />);
    const note = screen.getByTestId('plugin-permission-network-note');
    expect(note).toHaveTextContent('off your machine');
  });

  it('does NOT render notes for low-risk-only permissions', () => {
    render(
      <PluginPermissionsList
        permissions={['workspace:read', 'editor:selection', 'editor:write']}
      />,
    );
    expect(
      screen.queryByTestId('plugin-permission-workspace:read-note'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('plugin-permission-editor:selection-note'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('plugin-permission-editor:write-note'),
    ).not.toBeInTheDocument();
  });

  it('renders an icon for each permission', () => {
    render(<PluginPermissionsList permissions={ALL_PERMISSIONS} />);
    for (const p of ALL_PERMISSIONS) {
      const item = screen.getByTestId(`plugin-permission-${p}`);
      // Lucide renders inline svgs
      expect(item.querySelector('svg')).not.toBeNull();
    }
  });
});
