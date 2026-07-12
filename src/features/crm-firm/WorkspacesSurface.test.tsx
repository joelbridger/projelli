import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { createFirmWorkspace, openFirmWorkspace } = vi.hoisted(() => ({
  createFirmWorkspace: vi.fn(),
  openFirmWorkspace: vi.fn(),
}));

vi.mock('./workspaceSwitching', () => ({ createFirmWorkspace, openFirmWorkspace }));

let state = {
  rootPath: '/firms/northcrest',
  recentWorkspaces: [
    { path: '/firms/northcrest', name: 'Northcrest', lastOpened: new Date() },
    { path: '/firms/harbor', name: 'Harbor', lastOpened: new Date() },
  ],
};

vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: (selector: (value: typeof state) => unknown) => selector(state),
}));

import { WorkspacesSurface } from './WorkspacesSurface';

describe('WorkspacesSurface', () => {
  beforeEach(() => {
    createFirmWorkspace.mockReset().mockResolvedValue(true);
    openFirmWorkspace.mockReset().mockResolvedValue(true);
  });

  it('teaches that each firm space is private and marks the active space clearly', () => {
    render(<WorkspacesSurface />);
    expect(screen.getByTestId('crm-workspace-isolation-promise')).toHaveTextContent(/own encrypted data store/i);
    expect(screen.getByTestId('crm-workspace-current')).toHaveTextContent('northcrest');
    expect(screen.getByTestId('crm-workspace-current-badge')).toHaveTextContent('Open now');
    expect(screen.getByTestId('crm-workspace-open-0')).toBeDisabled();
  });

  it('creates a new firm space from its chosen folder', async () => {
    render(<WorkspacesSurface />);
    fireEvent.change(screen.getByTestId('crm-workspace-new-path'), { target: { value: '/firms/coast' } });
    fireEvent.click(screen.getByTestId('crm-workspace-create'));
    await waitFor(() => expect(createFirmWorkspace).toHaveBeenCalledWith('/firms/coast'));
    expect(await screen.findByTestId('crm-workspace-status')).toHaveTextContent(/new firm space is ready/i);
  });

  it('switches only when the advisor selects another saved firm space', async () => {
    render(<WorkspacesSurface />);
    fireEvent.click(screen.getByTestId('crm-workspace-open-1'));
    await waitFor(() => expect(openFirmWorkspace).toHaveBeenCalledWith('/firms/harbor'));
    expect(await screen.findByTestId('crm-workspace-status')).toHaveTextContent(/opened harbor/i);
  });
});
