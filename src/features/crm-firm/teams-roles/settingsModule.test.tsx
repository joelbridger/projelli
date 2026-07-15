import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { client } = vi.hoisted(() => ({
  client: {
    get: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    deleteRole: vi.fn(),
    createTeam: vi.fn(),
    updateTeam: vi.fn(),
    deleteTeam: vi.fn(),
    assignMember: vi.fn(),
  },
}));

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records: [
      {
        id: 'directory-maya',
        kind: 'firmDirectoryEntry',
        userId: 'maya',
        displayName: 'Maya Patel',
        active: true,
      },
    ],
    reload: vi.fn(),
  }),
}));
vi.mock('./teamsRolesClient', () => ({ teamsRolesClient: client }));

import { emptyTeamsRolesState } from './contract';
import { TeamsRolesSettings } from './settingsModule';
import { teamsRolesSettingsModule } from './settingsModule';
import {
  getSettingsModuleDescriptors,
  validateSettingsModuleDescriptors,
} from '@/features/settings/registry/settingsModuleRegistry';

describe('TeamsRolesSettings', () => {
  beforeEach(() => {
    client.get.mockReset().mockResolvedValue(emptyTeamsRolesState());
    client.assignMember.mockReset().mockResolvedValue(emptyTeamsRolesState());
    client.createTeam.mockReset().mockImplementation(async (team) => ({
      ...emptyTeamsRolesState(),
      teams: [team],
    }));
    client.deleteTeam.mockReset().mockResolvedValue(emptyTeamsRolesState());
    client.createRole.mockReset().mockResolvedValue(emptyTeamsRolesState());
    client.deleteRole.mockReset().mockResolvedValue(emptyTeamsRolesState());
  });

  it('has a unique, namespaced Organization settings descriptor', () => {
    expect(teamsRolesSettingsModule).toEqual(
      expect.objectContaining({
        id: 'organization',
        labelKey: 'teams-roles.settings-label',
      })
    );
    expect(() =>
      validateSettingsModuleDescriptors([
        ...getSettingsModuleDescriptors(),
        teamsRolesSettingsModule,
      ])
    ).not.toThrow();
  });

  it('renders people, the four role rows, and a role matrix behind the panel action', async () => {
    render(<TeamsRolesSettings {...({} as never)} />);
    expect(
      await screen.findByTestId('teams-roles-member-maya')
    ).toHaveTextContent('Maya Patel');
    expect(
      screen.getByTestId('teams-roles-role-row-advisor')
    ).toHaveTextContent('Advisors');
    expect(
      screen.queryByTestId('teams-roles-matrix-detail')
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('teams-roles-view-matrix'));
    expect(screen.getByTestId('teams-roles-matrix-detail')).toHaveTextContent(
      'clients:read'
    );
  });

  it('creates a team and assigns a member to a selected role', async () => {
    render(<TeamsRolesSettings {...({} as never)} />);
    await screen.findByTestId('teams-roles-member-maya');
    fireEvent.change(screen.getByTestId('teams-roles-team-name'), {
      target: { value: 'Planning' },
    });
    fireEvent.click(screen.getByTestId('teams-roles-create-team'));
    await waitFor(() =>
      expect(client.createTeam).toHaveBeenCalledWith({
        id: 'planning',
        name: 'Planning',
      })
    );
    fireEvent.change(screen.getByTestId('teams-roles-role-maya'), {
      target: { value: 'advisor' },
    });
    await waitFor(() =>
      expect(client.assignMember).toHaveBeenCalledWith({
        memberId: 'maya',
        roleId: 'advisor',
        teamIds: [],
      })
    );
  });
});
