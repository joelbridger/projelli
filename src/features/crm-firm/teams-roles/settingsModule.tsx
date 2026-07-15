import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, UsersRound } from 'lucide-react';
import { Button } from '@/ui/kp';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { roleForMember, type MemberAssignment } from './contract';
import {
  emptyTeamsRolesState,
  type ManagedRole,
  type TeamDefinition,
  type TeamsRolesState,
} from './model';
import { teamsRolesClient } from './teamsRolesClient';

declare module '@/platform/types/settings' {
  interface SettingsSectionMap {
    organization: true;
  }
}

type Member = LiveCrmRecord & {
  userId?: string;
  displayName?: string;
  email?: string;
  active?: boolean;
};

const panel = {
  border: '1px solid var(--kp-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)',
  padding: 'var(--kp-space-md)',
} as const;
const muted = {
  color: 'var(--kp-text-faint)',
  fontSize: 'var(--kp-font-sm)',
} as const;

function membersFrom(records: readonly LiveCrmRecord[]): Member[] {
  return records
    .filter((record): record is Member => record.kind === 'firmDirectoryEntry')
    .sort((a, b) =>
      (a.displayName ?? a.email ?? '').localeCompare(
        b.displayName ?? b.email ?? ''
      )
    );
}

function identifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function PeoplePanel({
  members,
  state,
  onAssign,
}: {
  members: readonly Member[];
  state: TeamsRolesState;
  onAssign: (assignment: MemberAssignment) => void;
}) {
  const { t } = useTranslation();
  return (
    <section data-testid="teams-roles-people" style={panel}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'start',
        }}
      >
        <div>
          <h2 style={{ marginTop: 0 }}>{t('teams-roles.people-title')}</h2>
          <p style={muted}>{t('teams-roles.people-copy')}</p>
        </div>
        <strong data-testid="teams-roles-active-count">
          {t('teams-roles.active-count', {
            count: members.filter((member) => member.active !== false).length,
          })}
        </strong>
      </div>
      {members.length === 0 ? (
        <p data-testid="teams-roles-people-empty" style={muted}>
          {t('teams-roles.people-empty')}
        </p>
      ) : (
        members.map((member) => {
          const memberId = member.userId ?? member.id;
          const role = roleForMember(state.roles, state.memberships, memberId);
          const current = state.memberships.find(
            (item) => item.memberId === memberId
          );
          const teamIds = current?.teamIds ?? [];
          return (
            <article
              key={member.id}
              data-testid={`teams-roles-member-${memberId}`}
              style={{
                borderTop: '1px solid var(--kp-border)',
                padding: '10px 0',
              }}
            >
              <strong>
                {member.displayName ??
                  member.email ??
                  t('teams-roles.unnamed-member')}
              </strong>
              <span style={muted}>
                {' '}
                ·{' '}
                {member.active === false
                  ? t('teams-roles.inactive')
                  : t('teams-roles.active')}
              </span>
              <label style={{ display: 'block', marginTop: 6, ...muted }}>
                {t('teams-roles.role-label')}
                <select
                  aria-label={t('teams-roles.role-for', {
                    name: member.displayName ?? memberId,
                  })}
                  data-testid={`teams-roles-role-${memberId}`}
                  value={role?.id ?? ''}
                  onChange={(event) => {
                    if (event.target.value)
                      onAssign({
                        memberId,
                        roleId: event.target.value,
                        teamIds,
                      });
                  }}
                >
                  <option value="">{t('teams-roles.choose-role')}</option>
                  {state.roles.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {state.teams.length > 0 && (
                <fieldset style={{ border: 0, margin: '8px 0 0', padding: 0 }}>
                  <legend style={muted}>{t('teams-roles.teams-label')}</legend>
                  {state.teams.map((team) => (
                    <label
                      key={team.id}
                      style={{
                        display: 'inline-flex',
                        marginRight: 12,
                        gap: 4,
                        ...muted,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={teamIds.includes(team.id)}
                        onChange={(event) => {
                          if (!role) return;
                          onAssign({
                            memberId,
                            roleId: role.id,
                            teamIds: event.target.checked
                              ? [...teamIds, team.id]
                              : teamIds.filter((id) => id !== team.id),
                          });
                        }}
                      />
                      {team.name}
                    </label>
                  ))}
                </fieldset>
              )}
            </article>
          );
        })
      )}
    </section>
  );
}

function TeamsPanel({
  state,
  onCreate,
  onDelete,
}: {
  state: TeamsRolesState;
  onCreate: (team: TeamDefinition) => void;
  onDelete: (teamId: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  return (
    <section data-testid="teams-roles-teams" style={panel}>
      <h2 style={{ marginTop: 0 }}>{t('teams-roles.teams-title')}</h2>
      <p style={muted}>{t('teams-roles.teams-copy')}</p>
      {state.teams.map((team) => (
        <article
          key={team.id}
          data-testid={`teams-roles-team-${team.id}`}
          style={{
            borderTop: '1px solid var(--kp-border)',
            padding: '10px 0',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span>
            <strong>{team.name}</strong>
            {team.description && (
              <small style={{ display: 'block', ...muted }}>
                {team.description}
              </small>
            )}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onDelete(team.id)}
          >
            {t('teams-roles.delete')}
          </Button>
        </article>
      ))}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const id = identifier(name);
          if (!id) return;
          onCreate({ id, name: name.trim() });
          setName('');
        }}
        style={{ display: 'flex', gap: 8, marginTop: 12 }}
      >
        <input
          aria-label={t('teams-roles.team-name')}
          data-testid="teams-roles-team-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('teams-roles.team-name')}
        />
        <Button type="submit" size="sm" data-testid="teams-roles-create-team">
          {t('teams-roles.add-team')}
        </Button>
      </form>
    </section>
  );
}

function RolesPanel({
  state,
  onCreate,
  onDelete,
}: {
  state: TeamsRolesState;
  onCreate: (role: ManagedRole) => void;
  onDelete: (roleId: string) => void;
}) {
  const { t } = useTranslation();
  const [showMatrix, setShowMatrix] = useState(false);
  const [name, setName] = useState('');
  return (
    <section data-testid="teams-roles-matrix" style={panel}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'start',
        }}
      >
        <div>
          <h2 style={{ marginTop: 0 }}>{t('teams-roles.roles-title')}</h2>
          <p style={muted}>{t('teams-roles.roles-copy')}</p>
        </div>
        <Button
          data-testid="teams-roles-view-matrix"
          size="sm"
          variant="secondary"
          iconLeft={ShieldCheck}
          onClick={() => setShowMatrix((value) => !value)}
        >
          {t('teams-roles.view-matrix')}
        </Button>
      </div>
      {state.roles.map((role) => (
        <article
          key={role.id}
          data-testid={`teams-roles-role-row-${role.id}`}
          style={{
            borderTop: '1px solid var(--kp-border)',
            padding: '10px 0',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span>
            <strong>{role.name}</strong>
            <p style={{ ...muted, margin: '4px 0' }}>{role.description}</p>
            <span style={muted}>
              {t('teams-roles.access-summary', {
                access: t(`teams-roles.scope.${role.clientAccess}`),
                count: state.memberships.filter(
                  (member) => member.roleId === role.id
                ).length,
              })}
            </span>
          </span>
          {!role.system && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onDelete(role.id)}
            >
              {t('teams-roles.delete')}
            </Button>
          )}
        </article>
      ))}
      {showMatrix && (
        <div
          data-testid="teams-roles-matrix-detail"
          style={{
            borderTop: '1px solid var(--kp-border)',
            marginTop: 8,
            paddingTop: 8,
          }}
        >
          <strong>{t('teams-roles.matrix-title')}</strong>
          {state.roles.map((role) => (
            <p key={role.id} style={muted}>
              {role.name}:{' '}
              {role.capabilities.join(' · ') ||
                t('teams-roles.no-capabilities')}
            </p>
          ))}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const id = identifier(name);
          if (!id) return;
          onCreate({
            id,
            name: name.trim(),
            description: t('teams-roles.custom-role-description'),
            clientAccess: 'none',
            capabilities: [],
            system: false,
          });
          setName('');
        }}
        style={{ display: 'flex', gap: 8, marginTop: 12 }}
      >
        <input
          aria-label={t('teams-roles.role-name')}
          data-testid="teams-roles-role-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('teams-roles.role-name')}
        />
        <Button type="submit" size="sm" data-testid="teams-roles-create-role">
          {t('teams-roles.add-role')}
        </Button>
      </form>
    </section>
  );
}

export function TeamsRolesSettings() {
  const { t } = useTranslation();
  const { records, reload } = useLiveCrmRecords();
  const [state, setState] = useState<TeamsRolesState>(emptyTeamsRolesState);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    void teamsRolesClient
      .get()
      .then(setState)
      .catch(() => setState(emptyTeamsRolesState()));
  }, []);
  const members = useMemo(() => membersFrom(records), [records]);
  const save = (operation: Promise<TeamsRolesState>, success: string) => {
    void operation
      .then((next) => {
        setState(next);
        setNotice(success);
        void reload();
      })
      .catch((error: unknown) =>
        setNotice(
          error instanceof Error ? error.message : t('teams-roles.save-failed')
        )
      );
  };
  return (
    <div
      data-testid="teams-roles-settings"
      style={{ display: 'grid', gap: 'var(--kp-space-md)', maxWidth: 880 }}
    >
      <header>
        <span style={muted}>{t('teams-roles.settings-label')}</span>
        <h1 style={{ margin: '4px 0' }}>
          <UsersRound
            size={22}
            aria-hidden
            style={{
              display: 'inline',
              marginRight: 8,
              verticalAlign: 'text-bottom',
            }}
          />
          {t('teams-roles.heading')}
        </h1>
        <p style={muted}>{t('teams-roles.heading-copy')}</p>
      </header>
      {notice && <p role="status">{notice}</p>}
      <PeoplePanel
        members={members}
        state={state}
        onAssign={(assignment) =>
          save(
            teamsRolesClient.assignMember(assignment),
            t('teams-roles.role-saved')
          )
        }
      />
      <TeamsPanel
        state={state}
        onCreate={(team) =>
          save(teamsRolesClient.createTeam(team), t('teams-roles.team-saved'))
        }
        onDelete={(teamId) =>
          save(
            teamsRolesClient.deleteTeam(teamId),
            t('teams-roles.team-deleted')
          )
        }
      />
      <RolesPanel
        state={state}
        onCreate={(role) =>
          save(teamsRolesClient.createRole(role), t('teams-roles.role-saved'))
        }
        onDelete={(roleId) =>
          save(
            teamsRolesClient.deleteRole(roleId),
            t('teams-roles.role-deleted')
          )
        }
      />
    </div>
  );
}

export const teamsRolesSettingsModule = {
  id: 'organization',
  order: 80,
  labelKey: 'teams-roles.settings-label',
  legacyLabel: 'Organization',
  searchTerms: [
    'people',
    'teams',
    'roles',
    'permissions',
    'advisor',
    'compliance',
  ],
  render: () => <TeamsRolesSettings />,
};
