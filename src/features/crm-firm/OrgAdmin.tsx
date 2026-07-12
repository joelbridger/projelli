/* eslint-disable lantern-i18n/no-hardcoded-string -- CRM copy is catalogued with the frozen CRM screens. */
import { useCallback, useState } from 'react';
import { Building2, ExternalLink, KeyRound, MonitorSmartphone, RefreshCw, Users } from 'lucide-react';
import { Button } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { useCrmHomeSurfaceContext } from '@/features/crm-home/surfaceContext';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { useFirm } from '@/platform/hooks/useFirm';
import { useFirmStore } from '@/platform/firm/firmStore';

const cardStyle = {
  border: '1px solid var(--kp-border)', borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)', padding: 'var(--kp-space-md)',
} as const;
const mutedStyle = { color: 'var(--kp-text-faint)', fontSize: 'var(--kp-font-sm)' } as const;

type Workspace = LiveCrmRecord & {
  kind: 'firmWorkspaceSummary'; name?: string; status?: 'active' | 'archived';
  memberIds?: string[]; restrictedMemberIds?: string[];
};
type Member = LiveCrmRecord & {
  kind: 'firmDirectoryEntry'; userId?: string; displayName?: string; email?: string;
  title?: string; active?: boolean; workspaceIds?: string[];
};
type Seat = LiveCrmRecord & {
  kind: 'firmSeatSummary'; memberId?: string; deviceName?: string;
  status?: 'active' | 'revoked'; lastSeenAt?: string;
};

function asWorkspace(record: LiveCrmRecord): record is Workspace {
  return record.kind === 'firmWorkspaceSummary';
}
function asMember(record: LiveCrmRecord): record is Member {
  return record.kind === 'firmDirectoryEntry';
}
function asSeat(record: LiveCrmRecord): record is Seat {
  return record.kind === 'firmSeatSummary';
}
function nameForMember(member: Member): string {
  return typeof member.displayName === 'string' && member.displayName.trim() ? member.displayName : 'Unnamed team member';
}
function workspaceName(workspace: Workspace): string {
  return typeof workspace.name === 'string' && workspace.name.trim() ? workspace.name : 'Unnamed workspace';
}
function formatSeen(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Not yet active';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Recently active' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * A saved, read-only picture of the existing firm-admin rails. It is not an
 * authority source: changes always happen in firm administration, which owns
 * invitations, roles, seats, and encryption-key access.
 */
export function OrgAdmin() {
  const { records, error, save } = useLiveCrmRecords();
  const { navigate } = useCrmHomeSurfaceContext();
  const firm = useFirm();
  const getClient = useFirmStore((state) => state.client);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const workspaces = records.filter(asWorkspace).sort((a, b) => workspaceName(a).localeCompare(workspaceName(b)));
  const members = records.filter(asMember).sort((a, b) => nameForMember(a).localeCompare(nameForMember(b)));
  const seats = records.filter(asSeat);
  const activeSeats = seats.filter((seat) => seat.status !== 'revoked').length;
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const memberById = new Map(members.map((member) => [member.userId ?? member.id, member]));
  const refresh = useCallback(async () => {
    if (firm.role !== 'admin') return;
    setRefreshing(true);
    setRefreshNotice(null);
    try {
      const client = getClient();
      const [matterResult, userResult, seatResult] = await Promise.all([
        client.listMatters(), client.listOrgUsers(), client.listSeats(),
      ]);
      const memberships = await Promise.all(matterResult.matters.map(async (matter) => ({
        matter,
        access: await client.listMatterMembers(matter.matter_id),
      })));
      const now = new Date().toISOString();
      const accessByUser = new Map<string, { workspaceIds: string[]; restrictedWorkspaceIds: string[] }>();
      for (const { matter, access } of memberships) {
        for (const member of access.members) {
          const current = accessByUser.get(member.user_id) ?? { workspaceIds: [], restrictedWorkspaceIds: [] };
          current.workspaceIds.push(matter.matter_id);
          if (access.walls.some((wall) => wall.user_id === member.user_id)) current.restrictedWorkspaceIds.push(matter.matter_id);
          accessByUser.set(member.user_id, current);
        }
      }
      await Promise.all([
        ...memberships.map(({ matter, access }) => save({
          id: `firm-workspace:${matter.matter_id}`, kind: 'firmWorkspaceSummary', matterId: 'firm_home',
          name: matter.client_name, status: matter.status, memberIds: access.members.map((member) => member.user_id),
          restrictedMemberIds: access.walls.map((wall) => wall.user_id), updatedAt: now,
        })),
        ...userResult.users.map((user) => {
          const access = accessByUser.get(user.user_id) ?? { workspaceIds: [], restrictedWorkspaceIds: [] };
          return save({ id: `firm-member:${user.user_id}`, kind: 'firmDirectoryEntry', matterId: 'firm_home', userId: user.user_id, displayName: user.email, email: user.email, title: user.role === 'admin' ? 'Administrator' : 'Member', active: user.status === 'active', teamLabels: [], workspaceIds: access.workspaceIds, restrictedWorkspaceIds: access.restrictedWorkspaceIds, updatedAt: now });
        }),
        ...seatResult.seats.map((seat) => save({ id: `firm-seat:${seat.seat_id}`, kind: 'firmSeatSummary', matterId: 'firm_home', memberId: seat.user_id, deviceName: seat.machine_label?.trim() || 'Unnamed device', status: seat.status, lastSeenAt: seat.last_seen, updatedAt: now })),
      ]);
      setRefreshNotice('Firm overview updated.');
    } catch {
      setRefreshNotice('Could not update this view. Check your firm connection and try again.');
    } finally {
      setRefreshing(false);
    }
  }, [firm.role, getClient, save]);

  return <main data-testid="crm-org-admin-surface" style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)' }}>
    <SurfaceHeader Icon={Building2} title="Firm overview" description="A clear picture of your firm’s workspaces, people, devices, and client access." actions={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{firm.role === 'admin' && <Button data-testid="crm-org-admin-refresh" variant="secondary" iconLeft={RefreshCw} disabled={refreshing} onClick={() => { void refresh(); }}>{refreshing ? 'Updating overview' : 'Update overview'}</Button>}<Button data-testid="crm-org-admin-open-firm-admin" iconLeft={ExternalLink} onClick={() => { navigate('firm-setup'); }}>Open firm administration</Button></div>} />
    <section data-testid="crm-org-admin-source-notice" style={{ ...cardStyle, borderColor: 'var(--kp-accent)' }}>
      <strong>One place manages access</strong>
      <p style={{ ...mutedStyle, marginBottom: 0 }}>This is a saved view of firm administration. To invite someone, change a role, manage a device, or change who can open a client, use firm administration. That keeps your firm’s access rules in one place.</p>
    </section>
    {error && <p role="alert">Could not load the firm overview: {error}</p>}
    {refreshNotice && <p data-testid="crm-org-admin-refresh-notice" role="status">{refreshNotice}</p>}
    <section data-testid="crm-org-admin-summary" aria-label="Firm overview summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--kp-space-sm)' }}>
      <div style={cardStyle}><Building2 size={18} aria-hidden /><strong data-testid="crm-org-admin-workspace-count" style={{ display: 'block', fontSize: 'var(--kp-font-xl)', marginTop: 6 }}>{workspaces.length}</strong><span style={mutedStyle}>Workspaces</span></div>
      <div style={cardStyle}><Users size={18} aria-hidden /><strong data-testid="crm-org-admin-member-count" style={{ display: 'block', fontSize: 'var(--kp-font-xl)', marginTop: 6 }}>{members.filter((member) => member.active !== false).length}</strong><span style={mutedStyle}>Active members</span></div>
      <div style={cardStyle}><MonitorSmartphone size={18} aria-hidden /><strong data-testid="crm-org-admin-seat-count" style={{ display: 'block', fontSize: 'var(--kp-font-xl)', marginTop: 6 }}>{activeSeats}</strong><span style={mutedStyle}>Active devices</span></div>
    </section>
    {workspaces.length === 0 && members.length === 0 && seats.length === 0 ? <section data-testid="crm-org-admin-empty" style={cardStyle}><h2 style={{ marginTop: 0 }}>Your firm overview will appear here</h2><p style={{ ...mutedStyle, marginBottom: 0 }}>After your firm administrator adds workspaces and people, this page will show who can work where. Nothing is guessed, and nothing can be changed from this page.</p></section> : <>
      <section data-testid="crm-org-admin-workspaces" style={cardStyle}><h2 style={{ marginTop: 0 }}>Workspaces</h2><p style={mutedStyle}>Each workspace is a separate place for a book of business or team.</p>{workspaces.length === 0 ? <p style={mutedStyle}>No workspaces have been shared with this view yet.</p> : <div>{workspaces.map((workspace) => { const memberCount = workspace.memberIds?.length ?? 0; const restricted = workspace.restrictedMemberIds?.length ?? 0; return <article key={workspace.id} data-testid={`crm-org-admin-workspace-${workspace.id}`} style={{ borderTop: '1px solid var(--kp-border)', padding: '10px 0' }}><strong>{workspaceName(workspace)}</strong><span style={mutedStyle}> · {workspace.status === 'archived' ? 'Archived' : 'Active'}</span><p style={{ ...mutedStyle, margin: '4px 0 0' }}>{memberCount === 1 ? '1 member can open this workspace.' : `${memberCount} members can open this workspace.`}{restricted ? ` ${restricted} ${restricted === 1 ? 'person has' : 'people have'} restricted client access.` : ' No client restrictions are listed.'}</p></article>; })}</div>}</section>
      <section data-testid="crm-org-admin-members" style={cardStyle}><h2 style={{ marginTop: 0 }}>Members and access</h2><p style={mutedStyle}>Roles and workspace access are shown here. Firm administration is still where they change.</p>{members.length === 0 ? <p style={mutedStyle}>No members have been shared with this view yet.</p> : <div>{members.map((member) => { const userId = member.userId ?? member.id; const access = (member.workspaceIds ?? []).map((id) => workspaceById.get(id)).filter((workspace): workspace is Workspace => Boolean(workspace)).map(workspaceName); return <article key={member.id} data-testid={`crm-org-admin-member-${member.id}`} style={{ borderTop: '1px solid var(--kp-border)', padding: '10px 0' }}><strong>{nameForMember(member)}</strong><span data-testid={`crm-org-admin-role-${member.id}`} style={mutedStyle}> · {typeof member.title === 'string' && member.title.trim() ? member.title : 'Member'} · {member.active === false ? 'Inactive' : 'Active'}</span>{typeof member.email === 'string' && member.email.trim() && <p style={{ ...mutedStyle, margin: '4px 0 0' }}>{member.email}</p>}<p data-testid={`crm-org-admin-access-${member.id}`} style={{ ...mutedStyle, margin: '4px 0 0' }}>{access.length ? `Can open: ${access.join(', ')}.` : 'No workspace access is listed.'}</p>{!memberById.has(userId) && null}</article>; })}</div>}</section>
      <section data-testid="crm-org-admin-seats" style={cardStyle}><h2 style={{ marginTop: 0 }}>Devices</h2><p style={mutedStyle}>A device uses one firm seat. Revoked devices cannot keep using the firm.</p>{seats.length === 0 ? <p style={mutedStyle}>No devices have been shared with this view yet.</p> : <div>{seats.map((seat) => { const owner = seat.memberId ? memberById.get(seat.memberId) : undefined; return <article key={seat.id} data-testid={`crm-org-admin-seat-${seat.id}`} style={{ borderTop: '1px solid var(--kp-border)', padding: '10px 0' }}><KeyRound size={15} aria-hidden style={{ verticalAlign: 'middle', marginRight: 6 }} /><strong>{typeof seat.deviceName === 'string' && seat.deviceName.trim() ? seat.deviceName : 'Unnamed device'}</strong><span style={mutedStyle}> · {seat.status === 'revoked' ? 'Revoked' : 'Active'} · {owner ? nameForMember(owner) : 'No member listed'}</span><p style={{ ...mutedStyle, margin: '4px 0 0' }}>Last active: {formatSeen(seat.lastSeenAt)}</p></article>; })}</div>}</section>
    </>}
  </main>;
}
