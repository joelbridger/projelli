/**
 * FirmAdminConsole — a minimal admin surface over the firm backend.
 *
 * Shown only to a signed-in firm ADMIN (Settings -> Firm). It calls the existing
 * admin endpoints via the firm store's authed client:
 *   - create a matter; list matters
 *   - add / remove a matter member by email (creates user if needed)
 *   - set / clear an ethical wall by email
 *   - view seats (who / machine / last seen / inactive)
 *   - set / delete the org's MANAGED provider keys for the Assured path
 *
 * Light theme; no em dashes; never renders a secret.
 *
 * Phase 1 (Task 3) changes:
 *   - Invite-by-email instead of raw user-id input.
 *   - Show member emails in lists (derived from members/list via user_id when
 *     known from the email-to-user mapping cache; falls back to user_id).
 *   - All strings moved to i18n (firm.admin namespace).
 *
 * NOTE: The /org/users/list endpoint (listOrgUsers) is used to seed the local
 * email -> user_id cache on load. For users that existed before this admin
 * session opened, their emails appear via the server response. For any user not
 * yet in the cache, we fall back to showing their truncated user_id.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FolderPlus,
  Users,
  ShieldX,
  ShieldCheck,
  RefreshCw,
  Trash2,
  KeyRound,
  Server,
  Copy,
} from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { cn } from '@/lib/utils';
import { useFirm } from '@/platform/hooks/useFirm';
import { useFirmStore } from '@/platform/firm/firmStore';
import {
  publishMatterKeyToMembers,
  autoRepublishHeldMatterKeys,
} from '@/platform/firm/matterKeyService';
import { AuditService } from '@/platform/audit/AuditService';
import type {
  FirmMatter,
  MatterMembersResponse,
  SeatSummary,
  AssuredProvider,
  ManagedKeyInfo,
  OrgUserEntry,
  SsoConfigView,
  IdpProvider,
} from '@/platform/firm/contract';
import type { SsoConfigSetRequest } from '@/platform/firm/contract';

const audit = new AuditService('firm');

const ASSURED_PROVIDERS: AssuredProvider[] = ['anthropic', 'openai', 'google'];

/** Generate a random 16-char temporary password. */
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]!).join('');
}

// ── VG-6a — persisted device-set fingerprints for the auto-republish poll ───
// Stored in localStorage so a reopened console doesn't re-wrap an unchanged
// org. Only fingerprints live here (user/device ids + epoch), never keys.

const PUBLISH_FP_STORAGE_KEY = 'keepance_firm_key_publish_fp';

function readPublishFingerprints(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PUBLISH_FP_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

function writePublishFingerprints(fingerprints: Record<string, string>): void {
  try {
    localStorage.setItem(PUBLISH_FP_STORAGE_KEY, JSON.stringify(fingerprints));
  } catch {
    // Storage unavailable: fingerprints just won't persist across sessions.
  }
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Users;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-sky-700" aria-hidden />
        <h4 className="text-sm font-medium">{title}</h4>
      </div>
      {children}
    </div>
  );
}

export function FirmAdminConsole() {
  const { t } = useTranslation();
  const firm = useFirm();
  const getClient = useFirmStore((s) => s.client);
  const refreshAssured = useFirmStore((s) => s.refreshAssuredProviders);

  const [matters, setMatters] = useState<FirmMatter[]>([]);
  const [seats, setSeats] = useState<SeatSummary[]>([]);
  const [managedKeys, setManagedKeys] = useState<ManagedKeyInfo[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUserEntry[]>([]);
  const [newClient, setNewClient] = useState('');
  const [selectedMatter, setSelectedMatter] = useState<string | null>(null);
  const [members, setMembers] = useState<MatterMembersResponse | null>(null);
  // Invite by email (replaces raw user-id input)
  const [memberEmail, setMemberEmail] = useState('');
  const [wallEmail, setWallEmail] = useState('');
  const [keyProvider, setKeyProvider] = useState<AssuredProvider>('anthropic');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [tempPasswordEmail, setTempPasswordEmail] = useState<string | null>(null);

  // SSO configuration state
  const [ssoView, setSsoView] = useState<SsoConfigView | null>(null);
  const [ssoProvider, setSsoProvider] = useState<IdpProvider>('entra');
  const [ssoIssuer, setSsoIssuer] = useState('');
  const [ssoClientId, setSsoClientId] = useState('');
  const [ssoClientSecret, setSsoClientSecret] = useState('');
  const [ssoEnabled, setSsoEnabled] = useState(true);
  const [ssoSecretTouched, setSsoSecretTouched] = useState(false);

  // Local cache: email -> user_id (kept for backward compat; populated from
  // listOrgUsers on load so the wall-by-email flow resolves without requiring
  // a prior invite).
  const [emailToUserId, setEmailToUserId] = useState<Record<string, string>>({});

  const run = useCallback(
    async (fn: () => Promise<void>, okMsg?: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      setTempPassword(null);
      setTempPasswordEmail(null);
      try {
        await fn();
        if (okMsg) setNotice(okMsg);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('common.actions.add'));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const loadMatters = useCallback(async () => {
    const res = await getClient().listMatters();
    setMatters(res.matters);
  }, [getClient]);

  const loadSeats = useCallback(async () => {
    const res = await getClient().listSeats();
    setSeats(res.seats);
  }, [getClient]);

  const loadManagedKeys = useCallback(async () => {
    const res = await getClient().listProviderKeys();
    setManagedKeys(res.keys);
  }, [getClient]);

  const loadOrgUsers = useCallback(async () => {
    try {
      const res = await getClient().listOrgUsers();
      setOrgUsers(res.users);
      // Seed the email->userId cache from the server response so wall-by-email
      // works for users that already existed before this admin session.
      setEmailToUserId((prev) => {
        const next = { ...prev };
        for (const u of res.users) {
          next[u.email] = u.user_id;
        }
        return next;
      });
    } catch {
      // Non-fatal: fall back to the local create-flow cache.
    }
  }, [getClient]);

  const loadSsoConfig = useCallback(async () => {
    const view = await getClient().ssoConfigGet();
    setSsoView(view);
    if (view.configured) {
      setSsoProvider(view.provider ?? 'entra');
      setSsoIssuer(view.issuer ?? '');
      setSsoClientId(view.client_id ?? '');
      setSsoEnabled(view.enabled ?? true);
      // Never pre-populate the secret; let the user know a saved secret exists
      setSsoClientSecret('');
      setSsoSecretTouched(false);
    }
  }, [getClient]);

  const loadMembers = useCallback(
    async (matterId: string) => {
      const res = await getClient().listMatterMembers(matterId);
      setMembers(res);
    },
    [getClient],
  );

  // Initial load when the admin console mounts.
  useEffect(() => {
    if (firm.role !== 'admin') return;
    void run(async () => {
      await Promise.all([loadMatters(), loadSeats(), loadManagedKeys(), loadOrgUsers(), loadSsoConfig()]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firm.role]);

  // VG-6a — auto-publish poll: while the admin console is open, newly
  // registered member devices get wrapped keys within a poll interval,
  // so the member's "waiting for your firm admin" state usually resolves
  // without a human dance. Fingerprints persist across sessions so a
  // reopened console doesn't re-wrap an unchanged org.
  const fpRef = useRef<Record<string, string>>(readPublishFingerprints());
  useEffect(() => {
    if (firm.role !== 'admin' || matters.length === 0) return undefined;
    let cancelled = false;
    const tick = async () => {
      const res = await autoRepublishHeldMatterKeys(getClient(), matters, fpRef.current);
      if (cancelled) return;
      fpRef.current = res.fingerprints;
      writePublishFingerprints(res.fingerprints);
      if (res.republishedMatterIds.length > 0) {
        setNotice(t('firm.admin.auto-republish-ok', { count: res.republishedMatterIds.length }));
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [firm.role, matters, getClient, t]);

  /** Invite a member by email: create user if needed, then add to matter. */
  const handleInvite = async (matterId: string) => {
    const email = memberEmail.trim();
    if (!email) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setTempPassword(null);
    setTempPasswordEmail(null);

    try {
      const client = getClient();
      let userId: string;
      let createdNew = false;
      let tmpPwd: string | null = null;

      // Check our local email cache first
      const cachedUserId = emailToUserId[email];
      if (cachedUserId) {
        userId = cachedUserId;
      } else {
        // Try creating the user. If 409, the user already exists. The
        // listOrgUsers call on mount should have seeded the cache; a 409
        // here means the user was created after this session loaded.
        tmpPwd = generateTempPassword();
        try {
          const createRes = await client.createUser(email, tmpPwd);
          userId = createRes.user.user_id;
          createdNew = true;
          setEmailToUserId((prev) => ({ ...prev, [email]: userId }));
        } catch (createErr) {
          const httpStatus = (createErr as { status?: number }).status;
          if (httpStatus === 409) {
            throw new Error(
              t('firm.admin.invite-user-exists', { email }),
            );
          }
          throw createErr;
        }
      }

      const addRes = await client.addMatterMember(matterId, userId, 'editor');
      setMemberEmail('');

      // Best-effort: publish the matter key to any devices already registered by
      // the new member. If the member hasn't registered their device yet, this
      // is a no-op (no devices → stored: 0). If the local key isn't available
      // (e.g. matter was created by a different admin session), this silently
      // skips — the admin can use "Re-publish keys" once the member registers.
      if (addRes.key_release === 'release_to_member') {
        try {
          await publishMatterKeyToMembers(client, matterId, addRes.key_epoch);
        } catch {
          // Non-fatal: member can open the re-publish button after registering.
        }
      }

      if (createdNew && tmpPwd) {
        setTempPassword(tmpPwd);
        setTempPasswordEmail(email);
        setNotice(t('firm.admin.invite-ok'));
      } else {
        setNotice(t('firm.admin.invite-ok'));
      }

      await loadMembers(matterId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('firm.admin.invite-failed'));
    } finally {
      setBusy(false);
    }
  };

  /** Re-publish matter keys to all currently registered member devices. */
  const handleRepublishKeys = async (matterId: string) => {
    const epoch = members?.key_epoch;
    if (!epoch) return;
    await run(async () => {
      await publishMatterKeyToMembers(getClient(), matterId, epoch);
    }, t('firm.admin.republish-keys-ok'));
  };

  /** Set wall by email. */
  const handleSetWall = async (matterId: string) => {
    const email = wallEmail.trim();
    if (!email) return;
    const userId = emailToUserId[email];
    if (!userId) {
      setError(t('firm.admin.wall-user-not-found', { email }));
      return;
    }
    await run(async () => {
      await getClient().setWall(matterId, userId);
      audit.append({
        type: 'wall_set_from_manager',
        timestamp: new Date().toISOString(),
        payload: {
          matter_id: matterId,
          firm_matter_id: matterId,
          target_user_id: userId,
          detail: `wall raised for ${email}`,
        },
      });
      setWallEmail('');
      await loadMembers(matterId);
    }, t('firm.admin.wall-ok'));
  };

  /** Display name for a user: email from cache if available, else truncated user_id. */
  const displayUser = useCallback(
    (userId: string): string => {
      const email = Object.entries(emailToUserId).find(([, uid]) => uid === userId)?.[0];
      return email ?? t('firm.admin.user-id-fallback', { id: userId.slice(0, 12) });
    },
    [emailToUserId, t],
  );

  if (!firm.isSignedIn) return null;
  if (firm.role !== 'admin') {
    return (
      <div data-testid="firm-admin-not-admin" className="py-3 text-xs text-muted-foreground">
        {t('firm.admin.not-admin')}
      </div>
    );
  }

  return (
    <div data-testid="firm-admin-console" className="space-y-3 py-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{t('firm.admin.title')}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="firm-admin-refresh"
          className="gap-1.5 text-xs"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await Promise.all([loadMatters(), loadSeats(), loadManagedKeys(), loadOrgUsers(), loadSsoConfig()]);
              if (selectedMatter) await loadMembers(selectedMatter);
            })
          }
        >
          <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
          {t('firm.admin.refresh')}
        </Button>
      </div>

      {error && (
        <p
          data-testid="firm-admin-error"
          className="text-xs rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-rose-900"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          data-testid="firm-admin-notice"
          className="text-xs rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900"
        >
          {notice}
        </p>
      )}

      {/* Matters */}
      <Section icon={FolderPlus} title={t('firm.admin.matters-section')}>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="firm-new-matter" className="text-xs">
              {t('firm.admin.new-matter-label')}
            </Label>
            <Input
              id="firm-new-matter"
              data-testid="firm-new-matter-name"
              value={newClient}
              onChange={(e) => { setNewClient(e.target.value); }}
              placeholder={t('firm.admin.new-matter-placeholder')}
            />
          </div>
          <Button
            type="button"
            size="sm"
            data-testid="firm-create-matter"
            disabled={busy || !newClient.trim()}
            onClick={() =>
              void run(async () => {
                await getClient().createMatter(newClient.trim());
                setNewClient('');
                await loadMatters();
              }, t('firm.admin.matter-created'))
            }
          >
            {t('firm.admin.create-matter')}
          </Button>
        </div>
        <ul data-testid="firm-matter-list" className="mt-2 space-y-1">
          {matters.length === 0 && (
            <li className="text-xs text-muted-foreground">{t('firm.admin.no-matters')}</li>
          )}
          {matters.map((m) => (
            <li key={m.matter_id}>
              <button
                type="button"
                data-testid={`firm-matter-${m.matter_id}`}
                onClick={() => {
                  setSelectedMatter(m.matter_id);
                  void run(() => loadMembers(m.matter_id));
                }}
                className={cn(
                  'w-full text-left rounded-md border px-2 py-1.5 text-xs transition-colors',
                  selectedMatter === m.matter_id
                    ? 'border-sky-400 bg-sky-50'
                    : 'border-border hover:bg-muted/30',
                )}
              >
                <span className="font-medium">{m.client_name}</span>
                <span className="ml-2 text-muted-foreground">
                  {t('firm.admin.epoch-label', { epoch: m.key_epoch })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      {/* Membership + walls for the selected matter */}
      {selectedMatter && (
        <Section icon={Users} title={t('firm.admin.members-section')}>
          <div className="space-y-2">
            {/* Invite by email */}
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="firm-member-email" className="text-xs">
                  {t('firm.admin.invite-label')}
                </Label>
                <Input
                  id="firm-member-email"
                  type="email"
                  data-testid="firm-member-email"
                  value={memberEmail}
                  onChange={(e) => { setMemberEmail(e.target.value); }}
                  placeholder={t('firm.admin.invite-placeholder')}
                />
              </div>
              <Button
                type="button"
                size="sm"
                data-testid="firm-add-member"
                disabled={busy || !memberEmail.trim()}
                onClick={() => void handleInvite(selectedMatter)}
              >
                {busy ? t('firm.admin.inviting') : t('firm.admin.invite-action')}
              </Button>
            </div>

            {/* Re-publish matter key to all registered member devices */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="firm-republish-keys"
              disabled={busy}
              className="w-full gap-1.5 text-xs"
              onClick={() => void handleRepublishKeys(selectedMatter)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('firm.admin.republish-keys-action')}
            </Button>

            {/* Temp password shown once after creating a new user */}
            {tempPassword && tempPasswordEmail && (
              <div
                className="rounded-md border border-amber-300 bg-amber-50 p-2 space-y-1"
                data-testid="firm-admin-temp-password"
              >
                <p className="text-xs font-medium text-amber-900">
                  {t('firm.admin.temp-password-label', { email: tempPasswordEmail })}
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
                    data-testid="firm-copy-temp-password"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-[11px] text-amber-700">
                  {t('firm.admin.temp-password-hint', { email: tempPasswordEmail })}
                </p>
              </div>
            )}

            {/* Set ethical wall by email */}
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="firm-wall-email" className="text-xs">
                  {t('firm.admin.wall-label')}
                </Label>
                <Input
                  id="firm-wall-email"
                  type="email"
                  data-testid="firm-wall-user-id"
                  value={wallEmail}
                  onChange={(e) => { setWallEmail(e.target.value); }}
                  placeholder={t('firm.admin.wall-placeholder')}
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="firm-set-wall"
                disabled={busy || !wallEmail.trim()}
                className="gap-1.5"
                onClick={() => void handleSetWall(selectedMatter)}
              >
                <ShieldX className="h-3.5 w-3.5" />
                {t('firm.admin.wall-action')}
              </Button>
            </div>

            {members && (
              <div className="mt-2 text-xs">
                <div className="text-muted-foreground">
                  {t('firm.admin.members-epoch', { epoch: members.key_epoch })}
                </div>
                <ul data-testid="firm-member-list" className="mt-1 space-y-1">
                  {members.members.map((mem) => (
                    <li
                      key={mem.user_id}
                      className="flex items-center justify-between rounded-md border border-border px-2 py-1"
                    >
                      <span className="text-[11px]">
                        {mem.email ?? displayUser(mem.user_id)}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground capitalize">{mem.role}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-testid={`firm-remove-member-${mem.user_id}`}
                          className="h-6 px-1.5 text-rose-700"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await getClient().removeMatterMember(selectedMatter, mem.user_id);
                              await loadMembers(selectedMatter);
                            }, t('firm.admin.remove-member-ok'))
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
                {members.walls.length > 0 && (
                  <div className="mt-2">
                    <div className="text-muted-foreground">{t('firm.admin.walls-label')}</div>
                    <ul data-testid="firm-wall-list" className="mt-1 space-y-1">
                      {members.walls.map((w) => {
                        const wallUser = orgUsers.find((u) => u.user_id === w.user_id);
                        return (
                        <li
                          key={w.user_id}
                          className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-2 py-1"
                        >
                          <span className="text-[11px]">
                            {wallUser?.email ?? displayUser(w.user_id)}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            data-testid={`firm-clear-wall-${w.user_id}`}
                            className="h-6 px-1.5 text-xs"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await getClient().clearWall(selectedMatter, w.user_id);
                                await loadMembers(selectedMatter);
                              }, t('firm.admin.clear-wall-ok'))
                            }
                          >
                            {t('firm.admin.clear-wall-action')}
                          </Button>
                        </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Seats */}
      <Section icon={Server} title={t('firm.admin.seats-section')}>
        <ul data-testid="firm-seat-list" className="space-y-1 text-xs">
          {seats.length === 0 && (
            <li className="text-muted-foreground">{t('firm.admin.no-seats')}</li>
          )}
          {seats.map((s) => (
            <li
              key={s.seat_id}
              className="flex items-center justify-between rounded-md border border-border px-2 py-1"
            >
              <span className="min-w-0">
                <span className="font-medium">
                  {s.machine_label ?? t('firm.admin.unnamed-device')}
                </span>
                <span className="ml-2 text-muted-foreground font-mono text-[11px]">
                  {s.user_id.slice(0, 8)}
                </span>
                {s.inactive && (
                  <span className="ml-2 text-amber-700">
                    {t('firm.admin.inactive-label')}
                  </span>
                )}
              </span>
              {s.status === 'active' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid={`firm-revoke-seat-${s.seat_id}`}
                  className="h-6 px-1.5 text-rose-700"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await getClient().revokeSeat(s.seat_id, 'admin_revoke');
                      audit.append({
                        type: 'seat_revoked',
                        timestamp: new Date().toISOString(),
                        payload: {
                          seat_id: s.seat_id,
                          ...(firm.org?.org_id ? { org_id: firm.org.org_id } : {}),
                          reason: 'admin_revoke',
                          detail: `revoked seat ${s.seat_id.slice(0, 12)} (${s.machine_label ?? 'unnamed'})`,
                        },
                      });
                      await loadSeats();
                    }, t('firm.admin.revoke-seat-ok'))
                  }
                >
                  {t('firm.admin.revoke-seat-action')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {/* Single sign-on (SSO) */}
      <Section icon={ShieldCheck} title={t('firm.admin.sso.section-title')}>
        <p className="mb-3 text-xs text-muted-foreground leading-relaxed">
          {t('firm.admin.sso.description')}
        </p>

        {/* Redirect URI — read-only, copyable */}
        <div className="mb-3 space-y-1">
          <Label htmlFor="sso-redirect-uri" className="text-xs">
            {t('firm.admin.sso.redirect-uri-label')}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="sso-redirect-uri"
              readOnly
              value={ssoView?.redirect_uri ?? ''}
              className="flex-1 font-mono text-xs bg-muted/40"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 px-2"
              title={t('firm.admin.sso.copy-redirect-uri-title')}
              onClick={() => {
                if (ssoView?.redirect_uri) {
                  void navigator.clipboard.writeText(ssoView.redirect_uri);
                }
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t('firm.admin.sso.redirect-uri-hint')}
          </p>
        </div>

        <div className="space-y-3">
          {/* Provider */}
          <div className="space-y-1">
            <Label htmlFor="sso-provider" className="text-xs">
              {t('firm.admin.sso.provider-label')}
            </Label>
            <select
              id="sso-provider"
              data-testid="sso-provider"
              value={ssoProvider}
              onChange={(e) => { setSsoProvider(e.target.value as IdpProvider); }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm w-full"
            >
              <option value="entra">{t('firm.admin.sso.provider-entra')}</option>
              <option value="google">{t('firm.admin.sso.provider-google')}</option>
              <option value="generic">{t('firm.admin.sso.provider-generic')}</option>
            </select>
            <p className="text-[11px] text-muted-foreground">
              {ssoProvider === 'entra' && t('firm.admin.sso.provider-hint-entra')}
              {ssoProvider === 'google' && t('firm.admin.sso.provider-hint-google')}
              {ssoProvider === 'generic' && t('firm.admin.sso.provider-hint-generic')}
            </p>
          </div>

          {/* Issuer URL */}
          <div className="space-y-1">
            <Label htmlFor="sso-issuer" className="text-xs">
              {t('firm.admin.sso.issuer-label')}
            </Label>
            <Input
              id="sso-issuer"
              type="url"
              data-testid="sso-issuer"
              value={ssoIssuer}
              onChange={(e) => { setSsoIssuer(e.target.value); }}
              placeholder={
                ssoProvider === 'entra'
                  ? t('firm.admin.sso.issuer-placeholder-entra')
                  : ssoProvider === 'google'
                  ? t('firm.admin.sso.issuer-placeholder-google')
                  : t('firm.admin.sso.issuer-placeholder-generic')
              }
            />
          </div>

          {/* Client ID */}
          <div className="space-y-1">
            <Label htmlFor="sso-client-id" className="text-xs">
              {t('firm.admin.sso.client-id-label')}
            </Label>
            <Input
              id="sso-client-id"
              data-testid="sso-client-id"
              value={ssoClientId}
              onChange={(e) => { setSsoClientId(e.target.value); }}
              placeholder={t('firm.admin.sso.client-id-placeholder')}
            />
          </div>

          {/* Client secret — write-only */}
          <div className="space-y-1">
            <Label htmlFor="sso-client-secret" className="text-xs">
              {t('firm.admin.sso.client-secret-label')}
            </Label>
            <Input
              id="sso-client-secret"
              type="password"
              data-testid="sso-client-secret"
              value={ssoClientSecret}
              onChange={(e) => {
                setSsoClientSecret(e.target.value);
                setSsoSecretTouched(true);
              }}
              placeholder={
                ssoView?.has_secret && !ssoSecretTouched
                  ? ''
                  : t('firm.admin.sso.client-secret-placeholder')
              }
            />
            {ssoView?.has_secret && !ssoSecretTouched && (
              <p className="text-[11px] text-emerald-700">
                {t('firm.admin.sso.secret-saved-hint')}
              </p>
            )}
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center gap-2">
            <input
              id="sso-enabled"
              type="checkbox"
              data-testid="sso-enabled"
              checked={ssoEnabled}
              onChange={(e) => { setSsoEnabled(e.target.checked); }}
              className="h-4 w-4 rounded border-input accent-sky-700"
            />
            <Label htmlFor="sso-enabled" className="text-xs cursor-pointer">
              {t('firm.admin.sso.enabled-label')}
            </Label>
          </div>

          {/* Save + Remove */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              data-testid="sso-save"
              disabled={
                busy ||
                !ssoIssuer.trim() ||
                !ssoClientId.trim() ||
                // Require a secret on first-time setup; allow blank (keep-existing) when one is already saved.
                (!ssoView?.has_secret && !ssoClientSecret.trim())
              }
              onClick={() =>
                void run(async () => {
                  const req: SsoConfigSetRequest = {
                    provider: ssoProvider,
                    issuer: ssoIssuer.trim(),
                    client_id: ssoClientId.trim(),
                    // Only include client_secret when the field was touched; omit it to keep the existing secret.
                    ...(ssoSecretTouched ? { client_secret: ssoClientSecret.trim() } : {}),
                    enabled: ssoEnabled,
                  };
                  await getClient().ssoConfigSet(req);
                  setSsoSecretTouched(false);
                  setSsoClientSecret('');
                  // Re-fetch to get the canonical view (has_secret etc.)
                  await loadSsoConfig();
                }, t('firm.admin.sso.save-ok'))
              }
            >
              {t('firm.admin.sso.save-action')}
            </Button>
            {ssoView?.configured && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="sso-delete"
                disabled={busy}
                className="text-rose-700 border-rose-300 hover:bg-rose-50"
                onClick={() =>
                  void run(async () => {
                    await getClient().ssoConfigDelete();
                    setSsoView((prev) => prev ? { ...prev, configured: false } : null);
                    setSsoProvider('entra');
                    setSsoIssuer('');
                    setSsoClientId('');
                    setSsoClientSecret('');
                    setSsoSecretTouched(false);
                    setSsoEnabled(true);
                    await loadSsoConfig();
                  }, t('firm.admin.sso.remove-ok'))
                }
              >
                {t('firm.admin.sso.remove-action')}
              </Button>
            )}
          </div>
        </div>
      </Section>

      {/* Assured managed keys */}
      <Section icon={KeyRound} title={t('firm.admin.assured-section')}>
        <p className="mb-2 text-xs text-muted-foreground leading-relaxed">
          {t('firm.admin.assured-description')}
        </p>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="firm-key-provider" className="text-xs">
              {t('firm.admin.provider-label')}
            </Label>
            <select
              id="firm-key-provider"
              data-testid="firm-key-provider"
              value={keyProvider}
              onChange={(e) => { setKeyProvider(e.target.value as AssuredProvider); }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {ASSURED_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 space-y-1">
            <Label htmlFor="firm-key-value" className="text-xs">
              {t('firm.admin.api-key-label')}
            </Label>
            <Input
              id="firm-key-value"
              data-testid="firm-key-value"
              type="password"
              value={apiKeyInput}
              onChange={(e) => { setApiKeyInput(e.target.value); }}
              placeholder="sk-..."
            />
          </div>
          <Button
            type="button"
            size="sm"
            data-testid="firm-set-key"
            disabled={busy || !apiKeyInput.trim()}
            onClick={() =>
              void run(async () => {
                await getClient().setProviderKey(keyProvider, apiKeyInput.trim());
                setApiKeyInput('');
                await loadManagedKeys();
                await refreshAssured();
              }, t('firm.admin.save-key-ok'))
            }
          >
            {t('firm.admin.save-key-action')}
          </Button>
        </div>
        <ul data-testid="firm-managed-key-list" className="mt-2 space-y-1 text-xs">
          {managedKeys.length === 0 && (
            <li className="text-muted-foreground">{t('firm.admin.no-keys')}</li>
          )}
          {managedKeys.map((k) => (
            <li
              key={k.provider}
              className="flex items-center justify-between rounded-md border border-border px-2 py-1"
            >
              <span>
                <span className="font-medium capitalize">{k.provider}</span>
                <span className="ml-2 text-muted-foreground font-mono">...{k.key_last4}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid={`firm-delete-key-${k.provider}`}
                className="h-6 px-1.5 text-rose-700"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await getClient().deleteProviderKey(k.provider);
                    await loadManagedKeys();
                    await refreshAssured();
                  }, t('firm.admin.delete-key-ok'))
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

export default FirmAdminConsole;
