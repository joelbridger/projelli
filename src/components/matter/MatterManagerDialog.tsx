/**
 * MatterManagerDialog (WS-B/C app) — create, rename, delete matters and map
 * each matter to one or more workspace folders.
 *
 * A matter maps to one or more folders; any file under a mapped folder belongs
 * to the matter, and indexing tags those files with the matter id. Changing a
 * mapping re-indexes the affected files (handled by useMemoryWiring's
 * subscription to the matter store).
 *
 * Light theme, navy accent, lean. Folder mapping is done by checking folders
 * from the current workspace tree — the simplest real model (folder = matter).
 *
 * Phase 1 (Task 3) additions:
 *   - "Share with my firm" action on unshared matters (firm session required).
 *   - "Shared matters I can access" section to open remote matters.
 *   - Member roster per shared matter with invite-by-email and remove.
 *   - Sync badge in MatterScopeSelector reads from matterSyncStore.
 *   - All firm UI is invisible when no firm session is active.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Briefcase,
  FileText,
  FolderOpen,
  Mail,
  Plus,
  Trash2,
  Check,
  ShieldAlert,
  Users,
  Share2,
  LogOut,
  Copy,
  RefreshCw,
  ShieldX,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useMatters, useMatterStore } from '@/stores/matterStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { FileNode } from '@/types/workspace';
import { mailConnectedAccounts, type ConnectedAccount } from '@/utils/mail-commands';
import { mailFolderKey } from '@/modules/memory/matterResolver';
import { useFirm } from '@/hooks/useFirm';
import { useFirmStore } from '@/stores/firmStore';
import { AuditService } from '@/modules/audit/AuditService';
import {
  getOrCreateMatterKey,
  publishMatterKeyToMembers,
  obtainMatterKey,
} from '@/modules/firm/matterKeyService';
import { registerDevice } from '@/modules/firm/deviceKeys';
import type { MatterMembersResponse, MatterMineSummary } from '@/modules/firm/contract';
import { openMatterNotes } from '@/modules/matter/openMatterNotes';
import { stopMatterSync } from '@/modules/matter/matterNotesSync';

export interface MatterManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Collect every folder path in the workspace tree (depth-first, sorted). */
function collectFolderPaths(nodes: FileNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: FileNode[]) => {
    for (const n of ns) {
      if (n.type === 'folder') {
        out.push(n.path);
        if (n.children) walk(n.children);
      }
    }
  };
  walk(nodes);
  return out.sort();
}

/** A short label for a folder path relative to the workspace root. */
function relLabel(path: string, root: string | null): string {
  if (!root) return path;
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const p = path.replace(/\\/g, '/');
  return p.startsWith(`${r}/`) ? p.slice(r.length + 1) : p;
}

/** Generate a random 16-char temporary password. */
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]!).join('');
}

const audit = new AuditService('firm');

// ────────────────────────────────────────────────────────────────────────────
// Sub-component: firm member roster for a single shared matter
// ────────────────────────────────────────────────────────────────────────────

interface MemberRosterProps {
  matterId: string;
  firmMatterId: string;
  canInvite: boolean; // owner or admin
}

function MemberRoster({ matterId, firmMatterId, canInvite }: MemberRosterProps) {
  const { t } = useTranslation();
  const getClient = useFirmStore((s) => s.client);
  const seatToken = useFirmStore((s) => s.seatToken);

  const [members, setMembers] = useState<MatterMembersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [tempPasswordEmail, setTempPasswordEmail] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getClient().listMatterMembers(firmMatterId);
      setMembers(res);
    } catch {
      // Non-fatal; show empty state
    } finally {
      setLoading(false);
    }
  }, [firmMatterId, getClient]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const handleInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    setBusy(true);
    setError(null);
    setTempPassword(null);
    setTempPasswordEmail(null);

    try {
      const client = getClient();
      let userId: string;
      let createdNew = false;
      let tmpPwd: string | null = null;

      // Strategy: always call createUser. If it succeeds, we have a new user.
      // If it 409-conflicts, the user already exists. The FirmAdminConsole has
      // a /org/users/list-backed cache (listOrgUsers) that the admin panel uses;
      // in this dialog we only have the member roster, so on 409 we surface a
      // clear message directing the admin to use the admin console.
      tmpPwd = generateTempPassword();
      try {
        const createRes = await client.createUser(email, tmpPwd);
        userId = createRes.user.user_id;
        createdNew = true;
      } catch (createErr) {
        // If 409 conflict (user already exists), we can't get the user_id
        // without a list-users endpoint. The plan says to show user_id with
        // the email when known and note the gap. Here we surface a clear message.
        const httpStatus = (createErr as { status?: number }).status;
        if (httpStatus === 409) {
          // User already exists. The admin console can look them up via
          // /org/users/list (listOrgUsers). Direct them there.
          throw new Error(
            t('matter.manager.firm-invite-user-exists', { email }),
          );
        }
        throw createErr;
      }

      // Add the user as a matter member
      const addRes = await client.addMatterMember(firmMatterId, userId, 'editor');

      // Re-publish keys if key_release is release_to_member
      if (addRes.key_release === 'release_to_member' && seatToken) {
        await publishMatterKeyToMembers(client, firmMatterId, addRes.key_epoch);
        audit.append({
          type: 'key_published',
          timestamp: new Date().toISOString(),
          payload: {
            matter_id: matterId,
            firm_matter_id: firmMatterId,
            detail: `key published after inviting ${email}`,
          },
        });
      }

      audit.append({
        type: 'member_invited',
        timestamp: new Date().toISOString(),
        payload: {
          matter_id: matterId,
          firm_matter_id: firmMatterId,
          target_user_id: userId,
          detail: `invited ${email}`,
        },
      });

      if (createdNew) {
        setTempPassword(tmpPwd);
        setTempPasswordEmail(email);
      }
      setInviteEmail('');
      await loadMembers();
    } catch (err) {
      setError(
        t('matter.manager.firm-invite-error', {
          email,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setBusy(true);
    setError(null);
    try {
      const client = getClient();
      const removeRes = await client.removeMatterMember(firmMatterId, userId);
      // Re-publish keys for the new epoch after removal
      await publishMatterKeyToMembers(client, firmMatterId, removeRes.key_epoch);
      audit.append({
        type: 'member_removed',
        timestamp: new Date().toISOString(),
        payload: {
          matter_id: matterId,
          firm_matter_id: firmMatterId,
          target_user_id: userId,
          detail: `removed user ${userId.slice(0, 8)}`,
        },
      });
      await loadMembers();
    } catch (err) {
      setError(
        t('matter.manager.firm-remove-error', {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="firm-members-loading">
        {t('matter.manager.firm-members-loading')}
      </p>
    );
  }

  return (
    <div className="space-y-2 mt-2" data-testid={`firm-member-roster-${matterId}`}>
      {/* Walled badges */}
      {members && members.walls.length > 0 && (
        <div className="space-y-1">
          {members.walls.map((w) => (
            <div
              key={w.user_id}
              className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs"
              data-testid={`firm-walled-${w.user_id}`}
            >
              <ShieldX className="h-3.5 w-3.5 shrink-0 text-amber-700" />
              <span className="flex-1 font-mono text-[11px] text-amber-900">
                {w.user_id.slice(0, 16)}
              </span>
              <span className="text-amber-700 font-medium">
                {t('matter.manager.firm-walled-badge')}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Member list */}
      <div data-testid={`firm-member-list-${matterId}`}>
        {!members || members.members.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('matter.manager.firm-members-empty')}
          </p>
        ) : (
          <ul className="space-y-1">
            {members.members.map((mem) => (
              <li
                key={mem.user_id}
                className="flex items-center justify-between rounded-md border px-2 py-1 text-xs"
                data-testid={`firm-member-${mem.user_id}`}
              >
                <span className="font-mono text-[11px] text-muted-foreground">
                  {mem.email ?? mem.user_id.slice(0, 16)}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground capitalize">{mem.role}</span>
                  {canInvite && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid={`firm-remove-member-${mem.user_id}`}
                      className="h-6 px-1.5 text-rose-700"
                      disabled={busy}
                      onClick={() => void handleRemove(mem.user_id)}
                      title={t('matter.manager.firm-remove-member-action')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Invite by email (admin / owner only) */}
      {canInvite && (
        <div className="space-y-1.5">
          <Label className="text-xs">{t('matter.manager.firm-invite-label')}</Label>
          <div className="flex gap-2">
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => { setInviteEmail(e.target.value); }}
              placeholder={t('matter.manager.firm-invite-placeholder')}
              className="h-8 text-xs"
              data-testid={`firm-invite-email-${matterId}`}
              disabled={busy}
            />
            <Button
              type="button"
              size="sm"
              data-testid={`firm-invite-submit-${matterId}`}
              disabled={busy || !inviteEmail.trim()}
              onClick={() => void handleInvite()}
              className="whitespace-nowrap"
            >
              {busy ? t('matter.manager.firm-inviting') : t('matter.manager.firm-invite-action')}
            </Button>
          </div>

          {/* Temp password shown once after creating a new user */}
          {tempPassword && tempPasswordEmail && (
            <div
              className="rounded-md border border-amber-300 bg-amber-50 p-2 space-y-1"
              data-testid={`firm-temp-password-${matterId}`}
            >
              <p className="text-xs font-medium text-amber-900">
                {t('matter.manager.firm-temp-password-label', { email: tempPasswordEmail })}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono bg-white border rounded px-2 py-1 select-all">
                  {tempPassword}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => void navigator.clipboard.writeText(tempPassword)}
                  title="Copy"
                  data-testid={`firm-copy-temp-password-${matterId}`}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-[11px] text-amber-700">
                {t('matter.manager.firm-temp-password-hint')}
              </p>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-rose-700" data-testid={`firm-member-error-${matterId}`}>
          {error}
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main dialog
// ────────────────────────────────────────────────────────────────────────────

export function MatterManagerDialog({ open, onOpenChange }: MatterManagerDialogProps) {
  const { t } = useTranslation();
  const matters = useMatters();
  const {
    createMatter,
    renameMatter,
    deleteMatter,
    addFolderPath,
    removeFolderPath,
    addMailFolderPath,
    removeMailFolderPath,
    setMatterPrivileged,
    linkFirmMatter,
    unlinkFirmMatter,
  } = useMatterStore();
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const fileTree = useWorkspaceStore((s) => s.fileTree);

  // Firm session
  const firm = useFirm();
  const getClient = useFirmStore((s) => s.client);
  const seatToken = useFirmStore((s) => s.seatToken);
  const firmSession = firm.isSignedIn && firm.hasActiveSeat;

  const folderPaths = useMemo(() => collectFolderPaths(fileTree), [fileTree]);

  // Connected mail accounts offered for an account-level mail -> matter mapping.
  const [mailAccounts, setMailAccounts] = useState<ConnectedAccount[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    mailConnectedAccounts()
      .then((accts) => {
        if (!cancelled) setMailAccounts(accts);
      })
      .catch(() => {
        /* no mail accounts / browser mode — leave empty */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Remote shared matters (from /matter/mine) that are not yet linked locally
  const [remoteMineMatters, setRemoteMineMatters] = useState<MatterMineSummary[]>([]);
  const [mineLoading, setMineLoading] = useState(false);

  const loadMineMatters = useCallback(async () => {
    if (!firmSession || !seatToken) return;
    setMineLoading(true);
    try {
      const res = await getClient().matterMine(seatToken);
      // Filter to only those not already linked locally
      const linkedFirmIds = new Set(
        matters.filter((m) => m.firmMatterId).map((m) => m.firmMatterId!),
      );
      setRemoteMineMatters(res.matters.filter((m) => !linkedFirmIds.has(m.matter_id)));
    } catch {
      setRemoteMineMatters([]);
    } finally {
      setMineLoading(false);
    }
  }, [firmSession, seatToken, getClient, matters]);

  useEffect(() => {
    if (open && firmSession) {
      void loadMineMatters();
    }
  }, [open, firmSession, loadMineMatters]);

  const [newName, setNewName] = useState('');
  const [newClient, setNewClient] = useState('');
  const [newPrivileged, setNewPrivileged] = useState(false);

  const handleCreate = () => {
    if (!newName.trim() && !newClient.trim()) return;
    createMatter({ name: newName, client: newClient, privileged: newPrivileged });
    setNewName('');
    setNewClient('');
    setNewPrivileged(false);
  };

  // ── Per-matter firm operations ──────────────────────────────────────────
  const [sharingMatterId, setSharingMatterId] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [openingRemoteId, setOpeningRemoteId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  // Expanded member roster for a local shared matter
  const [expandedRosterId, setExpandedRosterId] = useState<string | null>(null);

  const handleShare = async (matterId: string, clientName: string) => {
    setSharingMatterId(matterId);
    setShareError(null);
    // Track whether linkFirmMatter was called so the catch block can roll back
    // correctly. We cannot read `matters` in the catch — it is a render-time
    // snapshot and may be stale by the time the async op fails.
    let linkedLocalId: string | null = null;
    try {
      const client = getClient();

      // 1. Create the matter on the backend
      const createRes = await client.createMatter(clientName);
      const firmMatterId = createRes.matter.matter_id;
      const orgId = createRes.matter.org_id;
      const epoch = createRes.matter.key_epoch;

      // 2. Link the local matter to the firm matter
      linkFirmMatter(matterId, { firmMatterId, orgId, role: 'owner' });
      linkedLocalId = matterId;

      // 3. Ensure a local matter key exists
      await getOrCreateMatterKey(firmMatterId);

      // 4. Register this device with the backend
      await registerDevice(client);

      // 5. Publish the matter key to all members (just the owner for now)
      await publishMatterKeyToMembers(client, firmMatterId, epoch);

      // 6. Audit
      audit.append({
        type: 'matter_shared',
        timestamp: new Date().toISOString(),
        payload: {
          matter_id: matterId,
          firm_matter_id: firmMatterId,
          org_id: orgId,
          detail: `shared as firm matter ${firmMatterId}`,
        },
      });
    } catch (err) {
      setShareError(
        t('matter.manager.firm-share-error', {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      // Rollback: unlink using the tracked id rather than reading the stale
      // render-time `matters` snapshot, which may not reflect the link we just set.
      if (linkedLocalId) {
        const freshMatter = useMatterStore.getState().matters.find((x) => x.id === linkedLocalId);
        if (freshMatter?.firmMatterId) unlinkFirmMatter(linkedLocalId);
      }
    } finally {
      setSharingMatterId(null);
    }
  };

  const handleLeave = (matterId: string) => {
    const leavingMatter = matters.find((x) => x.id === matterId);
    // Stop the sync client before unlinking so the WebSocket is torn down
    // before the matter loses its firmMatterId.
    stopMatterSync(matterId);
    unlinkFirmMatter(matterId);
    audit.append({
      type: 'matter_unshared',
      timestamp: new Date().toISOString(),
      payload: {
        matter_id: matterId,
        ...(leavingMatter?.firmMatterId ? { firm_matter_id: leavingMatter.firmMatterId } : {}),
        detail: `unlinked from firm`,
      },
    });
    // Collapse roster if it was open for this matter
    if (expandedRosterId === matterId) setExpandedRosterId(null);
  };

  const handleOpenShared = async (remote: MatterMineSummary) => {
    setOpeningRemoteId(remote.matter_id);
    setOpenError(null);
    try {
      const client = getClient();

      // Register this device first so the admin can wrap the matter key for it.
      // This is idempotent (upsert) — safe to call every time.
      await registerDevice(client);

      // Attempt to obtain the matter key (seat token required for X-Seat-Token header)
      const key = await obtainMatterKey(client, remote.matter_id, seatToken ?? '');
      if (key === null) {
        setOpenError(t('matter.manager.firm-key-blocked'));
        return;
      }

      // Create a linked local matter
      createMatter({
        name: remote.client_name,
        client: remote.client_name,
        firmMatterId: remote.matter_id,
        orgId: firm.org?.org_id ?? '',
        role: remote.role,
        shared: true,
      });

      // Audit
      audit.append({
        type: 'matter_shared',
        timestamp: new Date().toISOString(),
        payload: {
          matter_id: remote.matter_id,
          firm_matter_id: remote.matter_id,
          ...(firm.org?.org_id ? { org_id: firm.org.org_id } : {}),
          detail: `opened remote matter ${remote.matter_id}`,
        },
      });

      // Refresh the mine list
      await loadMineMatters();
    } catch (err) {
      setOpenError(
        t('matter.manager.firm-open-error', {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setOpeningRemoteId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="matter-manager-dialog"
        className="max-w-2xl max-h-[80vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-primary" />
            {t('matter.manager.title')}
          </DialogTitle>
          <DialogDescription>{t('matter.manager.description')}</DialogDescription>
        </DialogHeader>

        {/* Create */}
        <div className="rounded-md border p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="matter-new-name" className="text-xs">
                {t('matter.manager.matter-name')}
              </Label>
              <Input
                id="matter-new-name"
                data-testid="matter-new-name"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                }}
                placeholder={t('matter.manager.matter-name-placeholder')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="matter-new-client" className="text-xs">
                {t('matter.manager.client-name')}
              </Label>
              <Input
                id="matter-new-client"
                data-testid="matter-new-client"
                value={newClient}
                onChange={(e) => {
                  setNewClient(e.target.value);
                }}
                placeholder={t('matter.manager.client-name-placeholder')}
              />
            </div>
          </div>
          <label
            className="mt-3 flex items-start gap-2 text-xs cursor-pointer select-none"
            data-testid="matter-new-privileged"
          >
            <input
              type="checkbox"
              checked={newPrivileged}
              onChange={(e) => {
                setNewPrivileged(e.target.checked);
              }}
              className="mt-0.5 h-3.5 w-3.5 accent-rose-600"
            />
            <span>
              <span className="inline-flex items-center gap-1 font-medium">
                <ShieldAlert className="h-3.5 w-3.5 text-rose-600" aria-hidden />
                {t('matter.manager.privileged-label')}
              </span>
              <span className="block text-muted-foreground">
                {t('matter.manager.privileged-hint')}
              </span>
            </span>
          </label>
          <Button
            data-testid="matter-create-button"
            size="sm"
            className="mt-3 gap-2"
            onClick={handleCreate}
            disabled={!newName.trim() && !newClient.trim()}
          >
            <Plus className="h-4 w-4" />
            {t('matter.manager.create')}
          </Button>
        </div>

        {/* ── Firm: "Shared matters I can access" (remote, not yet linked) ── */}
        {/* Only shown when there is an active firm session */}
        {firmSession && (
          <div
            data-testid="firm-shared-mine-section"
            className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" aria-hidden />
                {t('matter.manager.firm-open-shared-section')}
              </h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                disabled={mineLoading}
                onClick={() => void loadMineMatters()}
                data-testid="firm-refresh-mine"
                title="Refresh"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', mineLoading && 'animate-spin')} />
              </Button>
            </div>

            {mineLoading && (
              <p className="text-xs text-muted-foreground" data-testid="firm-mine-loading">
                {t('matter.manager.firm-open-shared-loading')}
              </p>
            )}

            {!mineLoading && remoteMineMatters.length === 0 && (
              <p className="text-xs text-muted-foreground" data-testid="firm-mine-empty">
                {t('matter.manager.firm-open-shared-empty')}
              </p>
            )}

            {openError && (
              <p className="text-xs text-rose-700" data-testid="firm-open-error">
                {openError}
              </p>
            )}

            {!mineLoading && remoteMineMatters.map((remote) => (
              <div
                key={remote.matter_id}
                className="flex items-center justify-between rounded-md border bg-white px-3 py-2 text-xs"
                data-testid={`firm-remote-matter-${remote.matter_id}`}
              >
                <span className="font-medium">{remote.client_name}</span>
                <span className="flex items-center gap-2">
                  <span className="capitalize text-muted-foreground">{remote.role}</span>
                  <Button
                    type="button"
                    size="sm"
                    data-testid={`firm-open-remote-${remote.matter_id}`}
                    disabled={openingRemoteId === remote.matter_id}
                    onClick={() => void handleOpenShared(remote)}
                  >
                    {openingRemoteId === remote.matter_id
                      ? t('matter.manager.firm-opening')
                      : t('matter.manager.firm-open-action')}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Existing matters */}
        <div className="space-y-3" data-testid="matter-list">
          {matters.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              {t('matter.manager.empty')}
            </p>
          ) : (
            matters.map((m) => (
              <div
                key={m.id}
                data-testid={`matter-row-${m.id}`}
                className="rounded-md border p-3 space-y-3"
              >
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    data-testid={`matter-name-${m.id}`}
                    value={m.name}
                    onChange={(e) => {
                      renameMatter(m.id, { name: e.target.value });
                    }}
                    className="h-8 text-sm font-medium"
                    aria-label={t('matter.manager.matter-name')}
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      data-testid={`matter-client-${m.id}`}
                      value={m.client}
                      onChange={(e) => {
                        renameMatter(m.id, { client: e.target.value });
                      }}
                      className="h-8 text-sm"
                      aria-label={t('matter.manager.client-name')}
                    />
                    <Button
                      data-testid={`matter-delete-${m.id}`}
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        deleteMatter(m.id);
                      }}
                      aria-label={t('matter.manager.delete')}
                      title={t('matter.manager.delete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Privileged-matter toggle */}
                <label
                  data-testid={`matter-privileged-${m.id}`}
                  data-checked={m.privileged ? 'true' : 'false'}
                  className="flex items-start gap-2 text-xs cursor-pointer select-none rounded-md border border-border/60 px-2 py-1.5"
                >
                  <input
                    type="checkbox"
                    checked={!!m.privileged}
                    onChange={(e) => {
                      setMatterPrivileged(m.id, e.target.checked);
                    }}
                    className="mt-0.5 h-3.5 w-3.5 accent-rose-600"
                    aria-label={t('matter.manager.privileged-label')}
                  />
                  <span>
                    <span className="inline-flex items-center gap-1 font-medium">
                      <ShieldAlert className="h-3.5 w-3.5 text-rose-600" aria-hidden />
                      {t('matter.manager.privileged-label')}
                    </span>
                    <span className="block text-muted-foreground">
                      {t('matter.manager.privileged-hint')}
                    </span>
                  </span>
                </label>

                {/* ── Firm sharing section (only when firm session active) ── */}
                {firmSession && (
                  <div
                    data-testid={`firm-section-${m.id}`}
                    className="rounded-md border border-primary/20 p-2 space-y-2"
                  >
                    {m.shared && m.firmMatterId ? (
                      // Already shared
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span
                            data-testid={`matter-firm-shared-badge-${m.id}`}
                            className="flex items-center gap-1.5 text-xs font-medium text-primary"
                          >
                            <Share2 className="h-3.5 w-3.5" aria-hidden />
                            {t('matter.manager.firm-shared-section')}
                            <span
                              data-testid="matter-firm-shared-badge"
                              className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                            >
                              {m.role ? t(`matter.manager.firm-${m.role}-badge`) : t('matter.manager.firm-shared-badge')}
                            </span>
                          </span>
                          <div className="flex items-center gap-1">
                            {/* Open shared notes for this matter */}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 gap-1 text-xs"
                              data-testid={`matter-open-notes-${m.id}`}
                              onClick={() => {
                                openMatterNotes(m.id);
                                onOpenChange(false);
                              }}
                              title={t('matter.manager.open-notes-action')}
                            >
                              <FileText className="h-3.5 w-3.5" />
                              <span className="sr-only">{t('matter.manager.open-notes-action')}</span>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => {
                                setExpandedRosterId(
                                  expandedRosterId === m.id ? null : m.id,
                                );
                              }}
                              data-testid={`firm-toggle-roster-${m.id}`}
                            >
                              <Users className="h-3.5 w-3.5" />
                            </Button>
                            {(m.role === 'owner' || firm.role === 'admin') && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-rose-700 hover:bg-rose-50"
                                onClick={() => handleLeave(m.id)}
                                data-testid={`firm-leave-${m.id}`}
                                title={t('matter.manager.firm-leave-hint')}
                              >
                                <LogOut className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Member roster (expanded) */}
                        {expandedRosterId === m.id && m.firmMatterId && (
                          <MemberRoster
                            matterId={m.id}
                            firmMatterId={m.firmMatterId}
                            canInvite={m.role === 'owner' || firm.role === 'admin'}
                          />
                        )}
                      </div>
                    ) : (
                      // Not yet shared
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {t('matter.manager.firm-share-section')}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs"
                          data-testid={`firm-share-${m.id}`}
                          disabled={sharingMatterId === m.id}
                          onClick={() => void handleShare(m.id, m.client || m.name)}
                        >
                          <Share2 className="h-3.5 w-3.5" />
                          {sharingMatterId === m.id
                            ? t('matter.manager.firm-sharing')
                            : t('matter.manager.firm-share-action')}
                        </Button>
                      </div>
                    )}

                    {shareError && sharingMatterId === null && m.id === matters[matters.length - 1]?.id && (
                      <p className="text-xs text-rose-700" data-testid="firm-share-error">
                        {shareError}
                      </p>
                    )}
                  </div>
                )}

                {/* Folder mapping */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    {t('matter.manager.folders-label')}
                  </p>
                  {folderPaths.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t('matter.manager.no-folders')}
                    </p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto rounded border divide-y">
                      {folderPaths.map((fp) => {
                        const checked = m.folderPaths.includes(fp);
                        return (
                          <button
                            key={fp}
                            type="button"
                            data-testid={`matter-folder-${m.id}-${fp}`}
                            data-checked={checked ? 'true' : 'false'}
                            onClick={() => {
                              if (checked) removeFolderPath(m.id, fp);
                              else addFolderPath(m.id, fp);
                            }}
                            className={cn(
                              'flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent',
                              checked && 'bg-primary/5',
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                                checked
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-muted-foreground/40',
                              )}
                            >
                              {checked && <Check className="h-3 w-3" />}
                            </span>
                            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{relLabel(fp, rootPath)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Email account mapping (account-level: every folder in the account) */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    {t('matter.manager.mail-label')}
                  </p>
                  {mailAccounts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t('matter.manager.no-mail-accounts')}
                    </p>
                  ) : (
                    <div className="rounded border divide-y">
                      {mailAccounts.map((acct) => {
                        const key = mailFolderKey(acct.provider, acct.account);
                        const checked = (m.mailFolderPaths ?? []).includes(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            data-testid={`matter-mail-${m.id}-${key}`}
                            data-checked={checked ? 'true' : 'false'}
                            onClick={() => {
                              if (checked) removeMailFolderPath(m.id, key);
                              else addMailFolderPath(m.id, key);
                            }}
                            className={cn(
                              'flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent',
                              checked && 'bg-primary/5',
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                                checked
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-muted-foreground/40',
                              )}
                            >
                              {checked && <Check className="h-3 w-3" />}
                            </span>
                            <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{acct.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {mailAccounts.length > 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t('matter.manager.mail-account-hint')}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MatterManagerDialog;
