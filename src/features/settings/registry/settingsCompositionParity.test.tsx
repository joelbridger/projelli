import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDevFlagOverride } from '@/platform/flags';
import { renderRegisteredSettingsPanels } from './sectionRendererBindings';
import type { SettingsSectionRenderProps } from './types';

const { client } = vi.hoisted(() => ({
  client: {
    get: vi.fn(),
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
vi.mock('@/features/crm-firm/teams-roles/teamsRolesClient', () => ({
  teamsRolesClient: client,
}));

const props: SettingsSectionRenderProps = {
  getSetting: () => undefined,
  setSetting: () => undefined,
  onAction: () => undefined,
  filteredKeys: new Set<string>(),
  searchQuery: '',
  searchActive: false,
  onNavigate: () => undefined,
  hasWorkspaceOpen: true,
};

const frozenPreMigrationState = {
  roles: [
    {
      id: 'advisor',
      name: 'Advisors',
      description: 'Assigned clients, Ask, meetings, and reports.',
      system: true,
      clientAccess: 'assigned',
      capabilities: [
        'clients:read',
        'clients:write',
        'ask:use',
        'meetings:read',
        'meetings:write',
        'reports:read',
      ],
    },
    {
      id: 'client-service',
      name: 'Client service',
      description: 'Assigned households, tasks, workflows, and meetings.',
      system: true,
      clientAccess: 'assigned',
      capabilities: [
        'clients:read',
        'clients:write',
        'tasks:manage',
        'workflows:manage',
        'meetings:read',
        'meetings:write',
      ],
    },
    {
      id: 'compliance-admin',
      name: 'Compliance admin',
      description: 'Firm-wide read access, exports, retention, and audit.',
      system: true,
      clientAccess: 'firm-read',
      capabilities: [
        'clients:read',
        'reports:read',
        'exports:run',
        'audit:read',
        'retention:manage',
        'firm:manage',
      ],
    },
    {
      id: 'guest-planner',
      name: 'Guest planner',
      description: 'Only households shared directly with this planner. No exports.',
      system: true,
      clientAccess: 'shared',
      capabilities: ['clients:read', 'ask:use', 'meetings:read'],
    },
  ],
  teams: [],
  memberships: [],
  updatedAt: '1970-01-01T00:00:00.000Z',
};

describe('Organization composition parity', () => {
  afterEach(() => {
    setDevFlagOverride('teams-roles', undefined);
  });

  it('matches the frozen pre-migration Organization DOM through the real registry mount', async () => {
    client.get.mockResolvedValue(frozenPreMigrationState);
    setDevFlagOverride('teams-roles', true);

    const composed = render(
      <>{renderRegisteredSettingsPanels('organization', props)}</>
    );
    await waitFor(() => {
      expect(
        composed.container.querySelector(
          '[data-testid="teams-roles-member-maya"]'
        )
      ).toBeInTheDocument();
    });

    expect(composed.container.innerHTML).toMatchInlineSnapshot(`"<div data-testid="teams-roles-settings" style="display: grid; gap: var(--kp-space-md); max-width: 880px;"><header><span style="color: var(--kp-text-faint); font-size: var(--kp-font-sm);">Organization</span><h1 style="margin: 4px 0px;"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-users-round" aria-hidden="true" style="display: inline; margin-right: 8px; vertical-align: text-bottom;"><path d="M18 21a8 8 0 0 0-16 0"></path><circle cx="10" cy="8" r="5"></circle><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"></path></svg>People and permissions</h1><p style="color: var(--kp-text-faint); font-size: var(--kp-font-sm);">Manage your firm’s people, teams, and roles in one place.</p></header><section data-testid="teams-roles-people" style="border: 1px solid var(--kp-border); border-radius: var(--radius-lg); background: var(--kp-surface); padding: var(--kp-space-md);"><div style="display: flex; justify-content: space-between; gap: 12px; align-items: start;"><div><h2 style="margin-top: 0px;">People</h2><p style="color: var(--kp-text-faint); font-size: var(--kp-font-sm);">Assign each active person one role and any teams they work with.</p></div><strong data-testid="teams-roles-active-count">1 active members</strong></div><article data-testid="teams-roles-member-maya" style="border-top: 1px solid var(--kp-border); padding: 10px 0px;"><strong>Maya Patel</strong><span style="color: var(--kp-text-faint); font-size: var(--kp-font-sm);"> · Active</span><label style="display: block; margin-top: 6px; color: var(--kp-text-faint); font-size: var(--kp-font-sm);">Role<select aria-label="Role for Maya Patel" data-testid="teams-roles-role-maya"><option value="">Choose a role</option><option value="advisor">Advisors</option><option value="client-service">Client service</option><option value="compliance-admin">Compliance admin</option><option value="guest-planner">Guest planner</option></select></label></article></section><section data-testid="teams-roles-teams" style="border: 1px solid var(--kp-border); border-radius: var(--radius-lg); background: var(--kp-surface); padding: var(--kp-space-md);"><h2 style="margin-top: 0px;">Teams</h2><p style="color: var(--kp-text-faint); font-size: var(--kp-font-sm);">Use teams to organize people. Roles, not teams, decide what a person can access.</p><form style="display: flex; gap: 8px; margin-top: 12px;"><input aria-label="Team name" data-testid="teams-roles-team-name" placeholder="Team name" value=""><button type="submit" class="kp-btn kp-btn--primary kp-btn--sm" data-testid="teams-roles-create-team">Add team</button></form></section><section data-testid="teams-roles-matrix" style="border: 1px solid var(--kp-border); border-radius: var(--radius-lg); background: var(--kp-surface); padding: var(--kp-space-md);"><div style="display: flex; justify-content: space-between; gap: 12px; align-items: start;"><div><h2 style="margin-top: 0px;">Teams &amp; roles</h2><p style="color: var(--kp-text-faint); font-size: var(--kp-font-sm);">The role matrix makes client access clear before someone opens a record.</p></div><button type="button" class="kp-btn kp-btn--secondary kp-btn--sm" data-testid="teams-roles-view-matrix"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shield-check" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path></svg>View role matrix</button></div><article data-testid="teams-roles-role-row-advisor" style="border-top: 1px solid var(--kp-border); padding: 10px 0px; display: flex; justify-content: space-between; gap: 8px;"><span><strong>Advisors</strong><p style="color: var(--kp-text-faint); font-size: var(--kp-font-sm); margin: 4px 0px;">Assigned clients, Ask, meetings, and reports.</p><span style="color: var(--kp-text-faint); font-size: var(--kp-font-sm);">Client access: assigned clients · 0 people</span></span></article><article data-testid="teams-roles-role-row-client-service" style="border-top: 1px solid var(--kp-border); padding: 10px 0px; display: flex; justify-content: space-between; gap: 8px;"><span><strong>Client service</strong><p style="color: var(--kp-text-faint); font-size: var(--kp-font-sm); margin: 4px 0px;">Assigned households, tasks, workflows, and meetings.</p><span style="color: var(--kp-text-faint); font-size: var(--kp-font-sm);">Client access: assigned clients · 0 people</span></span></article><article data-testid="teams-roles-role-row-compliance-admin" style="border-top: 1px solid var(--kp-border); padding: 10px 0px; display: flex; justify-content: space-between; gap: 8px;"><span><strong>Compliance admin</strong><p style="color: var(--kp-text-faint); font-size: var(--kp-font-sm); margin: 4px 0px;">Firm-wide read access, exports, retention, and audit.</p><span style="color: var(--kp-text-faint); font-size: var(--kp-font-sm);">Client access: firm-wide read · 0 people</span></span></article><article data-testid="teams-roles-role-row-guest-planner" style="border-top: 1px solid var(--kp-border); padding: 10px 0px; display: flex; justify-content: space-between; gap: 8px;"><span><strong>Guest planner</strong><p style="color: var(--kp-text-faint); font-size: var(--kp-font-sm); margin: 4px 0px;">Only households shared directly with this planner. No exports.</p><span style="color: var(--kp-text-faint); font-size: var(--kp-font-sm);">Client access: shared clients · 0 people</span></span></article><form style="display: flex; gap: 8px; margin-top: 12px;"><input aria-label="Role name" data-testid="teams-roles-role-name" placeholder="Role name" value=""><button type="submit" class="kp-btn kp-btn--primary kp-btn--sm" data-testid="teams-roles-create-role">Add role</button></form></section></div>"`);
  });
});
