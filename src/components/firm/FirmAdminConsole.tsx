/**
 * FirmAdminConsole — a minimal admin surface over the firm backend.
 *
 * Shown only to a signed-in firm ADMIN (Settings → Firm). It calls the existing
 * admin endpoints via the firm store's authed client:
 *   - create a matter; list matters
 *   - add / remove a matter member; set / clear an ethical wall
 *   - view seats (who / machine / last seen / inactive)
 *   - set / delete the org's MANAGED provider keys for the Assured path
 *
 * This is intentionally lean (the "basic console" the task asks for); deeper
 * admin UX (transfer, audit viewer, member directory) is a follow-up. Light
 * theme; no em dashes; never renders a secret.
 */
/* eslint-disable keepance-i18n/no-hardcoded-string */

import { useCallback, useEffect, useState } from 'react';
import {
  FolderPlus,
  Users,
  ShieldX,
  RefreshCw,
  Trash2,
  KeyRound,
  Server,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useFirm } from '@/hooks/useFirm';
import { useFirmStore } from '@/stores/firmStore';
import type {
  FirmMatter,
  MatterMembersResponse,
  SeatSummary,
  AssuredProvider,
  ManagedKeyInfo,
} from '@/modules/firm/contract';

const ASSURED_PROVIDERS: AssuredProvider[] = ['anthropic', 'openai', 'google'];

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
        <Icon className="h-4 w-4 text-sky-700 dark:text-sky-300" aria-hidden />
        <h4 className="text-sm font-medium">{title}</h4>
      </div>
      {children}
    </div>
  );
}

export function FirmAdminConsole() {
  const firm = useFirm();
  const getClient = useFirmStore((s) => s.client);
  const refreshAssured = useFirmStore((s) => s.refreshAssuredProviders);

  const [matters, setMatters] = useState<FirmMatter[]>([]);
  const [seats, setSeats] = useState<SeatSummary[]>([]);
  const [managedKeys, setManagedKeys] = useState<ManagedKeyInfo[]>([]);
  const [newClient, setNewClient] = useState('');
  const [selectedMatter, setSelectedMatter] = useState<string | null>(null);
  const [members, setMembers] = useState<MatterMembersResponse | null>(null);
  const [memberUserId, setMemberUserId] = useState('');
  const [wallUserId, setWallUserId] = useState('');
  const [keyProvider, setKeyProvider] = useState<AssuredProvider>('anthropic');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<void>, okMsg?: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await fn();
        if (okMsg) setNotice(okMsg);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed.');
      } finally {
        setBusy(false);
      }
    },
    [],
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
      await Promise.all([loadMatters(), loadSeats(), loadManagedKeys()]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firm.role]);

  if (!firm.isSignedIn) return null;
  if (firm.role !== 'admin') {
    return (
      <div data-testid="firm-admin-not-admin" className="py-3 text-xs text-muted-foreground">
        The firm console is available to administrators. Ask your firm admin to
        create matters and manage seats.
      </div>
    );
  }

  return (
    <div data-testid="firm-admin-console" className="space-y-3 py-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Firm console</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="firm-admin-refresh"
          className="gap-1.5 text-xs"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await Promise.all([loadMatters(), loadSeats(), loadManagedKeys()]);
              if (selectedMatter) await loadMembers(selectedMatter);
            })
          }
        >
          <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {error && (
        <p data-testid="firm-admin-error" className="text-xs rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}
      {notice && (
        <p data-testid="firm-admin-notice" className="text-xs rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          {notice}
        </p>
      )}

      {/* Matters */}
      <Section icon={FolderPlus} title="Matters">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="firm-new-matter" className="text-xs">New matter (client name)</Label>
            <Input
              id="firm-new-matter"
              data-testid="firm-new-matter-name"
              value={newClient}
              onChange={(e) => { setNewClient(e.target.value); }}
              placeholder="Acme Corp"
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
              }, 'Matter created.')
            }
          >
            Create
          </Button>
        </div>
        <ul data-testid="firm-matter-list" className="mt-2 space-y-1">
          {matters.length === 0 && (
            <li className="text-xs text-muted-foreground">No matters yet.</li>
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
                    ? 'border-sky-400 bg-sky-50 dark:bg-sky-950/40'
                    : 'border-border hover:bg-muted/30',
                )}
              >
                <span className="font-medium">{m.client_name}</span>
                <span className="ml-2 text-muted-foreground">epoch {m.key_epoch}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      {/* Membership + walls for the selected matter */}
      {selectedMatter && (
        <Section icon={Users} title="Membership and ethical walls">
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="firm-member-user" className="text-xs">Add member (user id)</Label>
                <Input
                  id="firm-member-user"
                  data-testid="firm-member-user-id"
                  value={memberUserId}
                  onChange={(e) => { setMemberUserId(e.target.value); }}
                  placeholder="user_..."
                />
              </div>
              <Button
                type="button"
                size="sm"
                data-testid="firm-add-member"
                disabled={busy || !memberUserId.trim()}
                onClick={() =>
                  void run(async () => {
                    await getClient().addMatterMember(selectedMatter, memberUserId.trim());
                    setMemberUserId('');
                    await loadMembers(selectedMatter);
                  }, 'Member added.')
                }
              >
                Add
              </Button>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="firm-wall-user" className="text-xs">Raise ethical wall (user id)</Label>
                <Input
                  id="firm-wall-user"
                  data-testid="firm-wall-user-id"
                  value={wallUserId}
                  onChange={(e) => { setWallUserId(e.target.value); }}
                  placeholder="user_..."
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="firm-set-wall"
                disabled={busy || !wallUserId.trim()}
                className="gap-1.5"
                onClick={() =>
                  void run(async () => {
                    await getClient().setWall(selectedMatter, wallUserId.trim());
                    setWallUserId('');
                    await loadMembers(selectedMatter);
                  }, 'Ethical wall raised.')
                }
              >
                <ShieldX className="h-3.5 w-3.5" />
                Wall
              </Button>
            </div>

            {members && (
              <div className="mt-2 text-xs">
                <div className="text-muted-foreground">
                  Members (epoch {members.key_epoch})
                </div>
                <ul data-testid="firm-member-list" className="mt-1 space-y-1">
                  {members.members.map((mem) => (
                    <li
                      key={mem.user_id}
                      className="flex items-center justify-between rounded-md border border-border px-2 py-1"
                    >
                      <span className="font-mono text-[11px]">{mem.user_id.slice(0, 12)}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground capitalize">{mem.role}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-testid={`firm-remove-member-${mem.user_id}`}
                          className="h-6 px-1.5 text-rose-700 dark:text-rose-300"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await getClient().removeMatterMember(selectedMatter, mem.user_id);
                              await loadMembers(selectedMatter);
                            }, 'Member removed (key epoch rotated).')
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
                    <div className="text-muted-foreground">Walled (screened)</div>
                    <ul data-testid="firm-wall-list" className="mt-1 space-y-1">
                      {members.walls.map((w) => (
                        <li
                          key={w.user_id}
                          className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-2 py-1 dark:border-amber-800 dark:bg-amber-950/40"
                        >
                          <span className="font-mono text-[11px]">{w.user_id.slice(0, 12)}</span>
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
                              }, 'Wall cleared.')
                            }
                          >
                            Clear
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Seats */}
      <Section icon={Server} title="Seats">
        <ul data-testid="firm-seat-list" className="space-y-1 text-xs">
          {seats.length === 0 && <li className="text-muted-foreground">No seats in use.</li>}
          {seats.map((s) => (
            <li
              key={s.seat_id}
              className="flex items-center justify-between rounded-md border border-border px-2 py-1"
            >
              <span className="min-w-0">
                <span className="font-medium">{s.machine_label ?? 'Unnamed device'}</span>
                <span className="ml-2 text-muted-foreground font-mono text-[11px]">
                  {s.user_id.slice(0, 8)}
                </span>
                {s.inactive && <span className="ml-2 text-amber-700 dark:text-amber-300">inactive</span>}
              </span>
              {s.status === 'active' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid={`firm-revoke-seat-${s.seat_id}`}
                  className="h-6 px-1.5 text-rose-700 dark:text-rose-300"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await getClient().revokeSeat(s.seat_id, 'admin_revoke');
                      await loadSeats();
                    }, 'Seat revoked.')
                  }
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {/* Assured managed keys */}
      <Section icon={KeyRound} title="Assured inference keys">
        <p className="mb-2 text-xs text-muted-foreground leading-relaxed">
          Store a managed provider key so members can use the Assured
          (zero-retention proxy) confidentiality mode. The key is encrypted at
          rest on the server and never shown again.
        </p>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="firm-key-provider" className="text-xs">Provider</Label>
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
            <Label htmlFor="firm-key-value" className="text-xs">API key</Label>
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
              }, 'Managed key saved.')
            }
          >
            Save
          </Button>
        </div>
        <ul data-testid="firm-managed-key-list" className="mt-2 space-y-1 text-xs">
          {managedKeys.length === 0 && (
            <li className="text-muted-foreground">No managed keys configured.</li>
          )}
          {managedKeys.map((k) => (
            <li
              key={k.provider}
              className="flex items-center justify-between rounded-md border border-border px-2 py-1"
            >
              <span>
                <span className="font-medium capitalize">{k.provider}</span>
                <span className="ml-2 text-muted-foreground font-mono">…{k.key_last4}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid={`firm-delete-key-${k.provider}`}
                className="h-6 px-1.5 text-rose-700 dark:text-rose-300"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await getClient().deleteProviderKey(k.provider);
                    await loadManagedKeys();
                    await refreshAssured();
                  }, 'Managed key deleted.')
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
