// Sub-component extracted from MatterManagerDialog.tsx — firm member roster for a single shared matter.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, ShieldX, Trash2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { useFirmStore } from '@/stores/firmStore';
import { publishMatterKeyToMembers } from '@/modules/firm/matterKeyService';
import type { MatterMembersResponse } from '@/modules/firm/contract';
import { generateTempPassword, audit } from './matterManagerDialogHelpers';

export interface MemberRosterProps {
  matterId: string;
  firmMatterId: string;
  canInvite: boolean; // owner or admin
}

export function MemberRoster({ matterId, firmMatterId, canInvite }: MemberRosterProps) {
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

      // createdNew is always true here (inner catch always rethrows on failure)
      setTempPassword(tmpPwd);
      setTempPasswordEmail(email);
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
