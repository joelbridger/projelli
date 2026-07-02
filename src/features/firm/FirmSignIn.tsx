/**
 * FirmSignIn — the opt-in firm sign-in + seat activation surface.
 *
 * Solo/local mode is unchanged and accountless; this panel is shown only to a
 * firm customer (Settings -> Firm). It covers three paths:
 *   1. Sign in (email + password) -> tokens stored in the OS keychain
 *   2. "I just bought Advisor Prep Hero Firm" -> claim-org form (license key + new
 *      admin account) -> signed in automatically + activation pre-filled
 *   3. Activate a seat with the firm license key -> seat token stored + verified
 *      offline against the seat public key
 *
 * Light-theme first; no em dashes. No secrets ever rendered or logged.
 */
/* eslint-disable lantern-i18n/no-hardcoded-string */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Building2,
  LogIn,
  LogOut,
  ShieldCheck,
  KeyRound,
  WifiOff,
  AlertCircle,
  ChevronLeft,
} from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { cn } from '@/lib/utils';
import { useFirm } from '@/platform/hooks/useFirm';
import type { SeatLimitExceededResponse } from '@/platform/firm/contract';

type Panel = 'signin' | 'claim';

export interface FirmSignInProps {
  /**
   * When set, the component starts with the specified panel open.
   * 'claim' → the "Create a firm" (claim-org) form.
   * 'signin' → the "Sign in" form (default if omitted).
   * Omitting the prop leaves the component in its normal interactive state
   * where the user can switch between panels via the "Just bought Advisor Prep Hero"
   * link. This keeps existing usage (no props) unchanged.
   */
  initialPanel?: Panel;
}

function StatusPill({ entitlement, isOffline }: { entitlement: ReturnType<typeof useFirm>['entitlement']; isOffline: boolean }) {
  let label = 'No seat';
  let tone = 'border-border bg-muted/30 text-muted-foreground';
  let Icon = AlertCircle;
  if (entitlement.state === 'subscription-active') {
    label = 'Seat active';
    tone = 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200';
    Icon = ShieldCheck;
  } else if (entitlement.state === 'offline-grace') {
    label = 'Active (offline)';
    tone = 'border-indigo-300 bg-indigo-50 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200';
    Icon = WifiOff;
  } else if (entitlement.reason.startsWith('firm-seat-revoked') || entitlement.state === 'subscription-lapsed') {
    label = 'Seat inactive';
    tone = 'border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200';
    Icon = AlertCircle;
  }
  return (
    <span
      data-testid="firm-seat-status"
      data-state={entitlement.state}
      data-offline={isOffline ? 'true' : 'false'}
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', tone)}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}

export function FirmSignIn({ initialPanel }: FirmSignInProps = {}) {
  const { t } = useTranslation();
  const firm = useFirm();
  const [panel, setPanel] = useState<Panel>(initialPanel ?? 'signin');

  // Sign-in panel state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Claim-org panel state
  const [claimLicenseKey, setClaimLicenseKey] = useState('');
  const [claimEmail, setClaimEmail] = useState('');
  const [claimPassword, setClaimPassword] = useState('');
  const [claimConfirm, setClaimConfirm] = useState('');
  const [claimOrgName, setClaimOrgName] = useState('');
  const [claimSuccess, setClaimSuccess] = useState(false);

  // Seat activation panel state (pre-filled after claim)
  const [licenseKey, setLicenseKey] = useState('');
  const [machineLabel, setMachineLabel] = useState('');

  // Shared error + seat-limit state
  const [localError, setLocalError] = useState<string | null>(null);
  const [seatLimit, setSeatLimit] = useState<SeatLimitExceededResponse | null>(null);

  // SSO sign-in is its own local flag (distinct from firm.isLoading, which is
  // shared with the password sign-in/claim/activate flows) so the Cancel
  // button shows only for the SSO wait it belongs to.
  const [ssoInProgress, setSsoInProgress] = useState(false);

  // Abort a pending SSO sign-in immediately instead of leaving the user
  // stuck on the browser popup for the full 5-minute server-side timeout
  // with no way out. No session is ever established from a cancelled wait.
  function cancelSso() {
    firm.signInSsoCancel().catch(() => {});
  }

  const onSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    void (async () => {
      const res = await firm.signIn(email, password);
      if (!res.ok) setLocalError(res.error ?? t('firm.signin.submit'));
      else setPassword('');
    })();
  };

  const onClaim = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (claimPassword !== claimConfirm) {
      setLocalError(t('firm.claim.error-password-mismatch'));
      return;
    }
    void (async () => {
      const res = await firm.claimOrg(
        claimLicenseKey,
        claimEmail,
        claimPassword,
        claimOrgName || undefined,
      );
      if (!res.ok) {
        const raw = res.error ?? '';
        if (raw.includes('already') || raw.includes('already_claimed')) {
          setLocalError(t('firm.claim.error-already-claimed'));
        } else if (raw.includes('not_found') || raw.includes('license_key_not_found')) {
          setLocalError(t('firm.claim.error-not-found'));
        } else {
          setLocalError(raw || t('firm.claim.submit'));
        }
      } else {
        // Pre-fill the activation form with the license key and show success message.
        setLicenseKey(res.claimedLicenseKey ?? claimLicenseKey.trim());
        setClaimSuccess(true);
        setClaimPassword('');
        setClaimConfirm('');
      }
    })();
  };

  const onActivate = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSeatLimit(null);
    void (async () => {
      const res = await firm.activateSeat(licenseKey, machineLabel || undefined);
      if (!res.ok) {
        setLocalError(res.error ?? 'Activation failed.');
        if (res.seatLimit) setSeatLimit(res.seatLimit);
      } else {
        setLicenseKey('');
      }
    })();
  };

  return (
    <div data-testid="firm-signin" className="py-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-sky-700 dark:text-sky-300" aria-hidden />
          <h3 className="text-sm font-medium">{t('firm.signin.account-heading')}</h3>
        </div>
        {firm.isSignedIn && <StatusPill entitlement={firm.entitlement} isOffline={firm.isOffline} />}
      </div>

      {!firm.isSignedIn ? (
        <>
          {/* ── Claim-org panel ───────────────────────────────────────────── */}
          {panel === 'claim' && (
            <div className="space-y-4 max-w-md">
              <button
                type="button"
                data-testid="firm-claim-back"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => { setPanel('signin'); setLocalError(null); setClaimSuccess(false); }}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {t('firm.signin.back-to-signin')}
              </button>

              {claimSuccess ? (
                /* Success state: org claimed, show hint to activate */
                <div
                  data-testid="firm-claim-success"
                  className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 space-y-1"
                >
                  <p className="font-medium">{t('firm.claim.success-heading')}</p>
                  <p className="text-emerald-700">{t('firm.claim.success-hint')}</p>
                </div>
              ) : (
                <form onSubmit={onClaim} className="space-y-3" data-testid="firm-claim-form">
                  <div>
                    <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                      {t('firm.claim.description')}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="claim-license" className="text-xs">
                      {t('firm.claim.license-key-label')}
                    </Label>
                    <Input
                      id="claim-license"
                      data-testid="firm-claim-license-key"
                      value={claimLicenseKey}
                      onChange={(e) => { setClaimLicenseKey(e.target.value); }}
                      placeholder={t('firm.claim.license-key-placeholder')}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="claim-email" className="text-xs">
                      {t('firm.claim.email-label')}
                    </Label>
                    <Input
                      id="claim-email"
                      data-testid="firm-claim-email"
                      type="email"
                      autoComplete="username"
                      value={claimEmail}
                      onChange={(e) => { setClaimEmail(e.target.value); }}
                      placeholder={t('firm.claim.email-placeholder')}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="claim-password" className="text-xs">
                      {t('firm.claim.password-label')}
                    </Label>
                    <Input
                      id="claim-password"
                      data-testid="firm-claim-password"
                      type="password"
                      autoComplete="new-password"
                      value={claimPassword}
                      onChange={(e) => { setClaimPassword(e.target.value); }}
                      placeholder={t('firm.claim.password-placeholder')}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="claim-confirm" className="text-xs">
                      {t('firm.claim.confirm-password-label')}
                    </Label>
                    <Input
                      id="claim-confirm"
                      data-testid="firm-claim-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={claimConfirm}
                      onChange={(e) => { setClaimConfirm(e.target.value); }}
                      placeholder={t('firm.claim.confirm-password-placeholder')}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="claim-org" className="text-xs">
                      {t('firm.claim.org-name-label')}
                    </Label>
                    <Input
                      id="claim-org"
                      data-testid="firm-claim-org-name"
                      value={claimOrgName}
                      onChange={(e) => { setClaimOrgName(e.target.value); }}
                      placeholder={t('firm.claim.org-name-placeholder')}
                    />
                  </div>
                  <Button
                    type="submit"
                    data-testid="firm-claim-submit"
                    disabled={firm.isLoading}
                    className="gap-1.5"
                  >
                    <KeyRound className="h-4 w-4" />
                    {firm.isLoading ? t('firm.claim.submitting') : t('firm.claim.submit')}
                  </Button>
                  {(localError || firm.error) && (
                    <p data-testid="firm-claim-error" className="text-xs text-rose-700 dark:text-rose-300">
                      {localError ?? firm.error}
                    </p>
                  )}
                </form>
              )}

              {/* After success: show the activation form pre-filled */}
              {claimSuccess && !firm.hasActiveSeat && (
                <form onSubmit={onActivate} className="space-y-3 rounded-lg border border-sky-200 dark:border-sky-900/60 p-3" data-testid="firm-activate-form">
                  <div className="space-y-1">
                    <Label htmlFor="claim-activate-license" className="text-xs">License key</Label>
                    <Input
                      id="claim-activate-license"
                      data-testid="firm-license-key"
                      value={licenseKey}
                      onChange={(e) => { setLicenseKey(e.target.value); }}
                      placeholder="KEEP-XXXX-XXXX-XXXX-XXXX"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="claim-activate-machine" className="text-xs">This device (optional)</Label>
                    <Input
                      id="claim-activate-machine"
                      data-testid="firm-machine-label"
                      value={machineLabel}
                      onChange={(e) => { setMachineLabel(e.target.value); }}
                      placeholder="Work laptop"
                    />
                  </div>
                  <Button type="submit" data-testid="firm-activate-submit" disabled={firm.isLoading} className="gap-1.5">
                    <KeyRound className="h-4 w-4" />
                    {firm.isLoading ? 'Activating...' : 'Activate seat'}
                  </Button>
                  {seatLimit && (
                    <p data-testid="firm-seat-limit" className="text-xs rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      All {seatLimit.seat_limit} seats are in use. An admin can free one
                      by revoking a seat in the firm console, then try again.
                    </p>
                  )}
                  {(localError || firm.error) && !seatLimit && (
                    <p data-testid="firm-activate-error" className="text-xs text-rose-700 dark:text-rose-300">
                      {localError ?? firm.error}
                    </p>
                  )}
                </form>
              )}
            </div>
          )}

          {/* ── Sign-in panel ────────────────────────────────────────────── */}
          {panel === 'signin' && (
            <form onSubmit={onSignIn} className="space-y-3 max-w-md" data-testid="firm-signin-form">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t('firm.signin.solo-notice')}
              </p>
              <div className="space-y-1">
                <Label htmlFor="firm-email" className="text-xs">{t('firm.signin.email-label')}</Label>
                <Input
                  id="firm-email"
                  data-testid="firm-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); }}
                  placeholder={t('firm.signin.email-placeholder')}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="firm-password" className="text-xs">{t('firm.signin.password-label')}</Label>
                <Input
                  id="firm-password"
                  data-testid="firm-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); }}
                  required
                />
              </div>
              <div className="flex items-center gap-3">
                <Button type="submit" data-testid="firm-signin-submit" disabled={firm.isLoading} className="gap-1.5">
                  <LogIn className="h-4 w-4" />
                  {firm.isLoading ? t('firm.signin.submitting') : t('firm.signin.submit')}
                </Button>
              </div>
              {(localError || firm.error) && (
                <p data-testid="firm-error" className="text-xs text-rose-700 dark:text-rose-300">
                  {localError ?? firm.error}
                </p>
              )}
              {isTauri() && (
                <>
                  <div className="my-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    or
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      data-testid="firm-sso-submit"
                      className="w-full gap-1.5"
                      disabled={!email || firm.isLoading}
                      onClick={() => {
                        setLocalError(null);
                        setSsoInProgress(true);
                        void firm.signInSso(email)
                          .catch((err: unknown) => {
                            const message = err instanceof Error ? err.message : 'SSO sign-in failed';
                            // The user clicked Cancel — an intentional exit, not a failure.
                            if (message !== 'cancelled') setLocalError(message);
                          })
                          .finally(() => { setSsoInProgress(false); });
                      }}
                    >
                      Sign in with SSO
                    </Button>
                    {ssoInProgress && (
                      <Button
                        type="button"
                        variant="outline"
                        data-testid="firm-sso-cancel"
                        onClick={cancelSso}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Use your firm's Microsoft, Google, or company login. Your admin sets this up.
                  </p>
                </>
              )}
              <button
                type="button"
                data-testid="firm-just-bought"
                className="text-xs text-sky-700 hover:underline dark:text-sky-400 mt-1"
                onClick={() => { setPanel('claim'); setLocalError(null); }}
              >
                {t('firm.signin.just-bought-link')}
              </button>
            </form>
          )}
        </>
      ) : (
        <div className="space-y-4 max-w-md">
          <div className="rounded-lg border border-border p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('firm.signin.signed-in-as')}</span>
              <span data-testid="firm-email-display" className="font-medium">{firm.email}</span>
            </div>
            {firm.org && (
              <div className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground">{t('firm.signin.firm-label')}</span>
                <span data-testid="firm-org-name" className="font-medium">{firm.org.name}</span>
              </div>
            )}
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">{t('firm.signin.role-label')}</span>
              <span className="font-medium capitalize">{firm.role}</span>
            </div>
            {firm.seatId && (
              <div className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground">{t('firm.signin.seat-label')}</span>
                <span data-testid="firm-seat-id" className="font-mono text-[11px]">{firm.seatId.slice(0, 8)}</span>
              </div>
            )}
          </div>

          {!firm.hasActiveSeat && (
            <form data-testid="firm-activate-form" onSubmit={onActivate} className="space-y-3 rounded-lg border border-sky-200 dark:border-sky-900/60 p-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Activate a seat on this machine with your firm license key. The
                seat is bound to this device and verified offline.
              </p>
              <div className="space-y-1">
                <Label htmlFor="firm-license" className="text-xs">License key</Label>
                <Input
                  id="firm-license"
                  data-testid="firm-license-key"
                  value={licenseKey}
                  onChange={(e) => { setLicenseKey(e.target.value); }}
                  placeholder="KEEP-XXXX-XXXX-XXXX-XXXX"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="firm-machine-label" className="text-xs">This device (optional)</Label>
                <Input
                  id="firm-machine-label"
                  data-testid="firm-machine-label"
                  value={machineLabel}
                  onChange={(e) => { setMachineLabel(e.target.value); }}
                  placeholder="Work laptop"
                />
              </div>
              <Button type="submit" data-testid="firm-activate-submit" disabled={firm.isLoading} className="gap-1.5">
                <KeyRound className="h-4 w-4" />
                {firm.isLoading ? 'Activating...' : 'Activate seat'}
              </Button>
              {seatLimit && (
                <p data-testid="firm-seat-limit" className="text-xs rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  All {seatLimit.seat_limit} seats are in use. An admin can free one
                  by revoking a seat in the firm console, then try again.
                </p>
              )}
              {(localError || firm.error) && !seatLimit && (
                <p data-testid="firm-activate-error" className="text-xs text-rose-700 dark:text-rose-300">
                  {localError ?? firm.error}
                </p>
              )}
            </form>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="firm-signout"
            className="gap-1.5"
            onClick={() => void firm.signOut()}
          >
            <LogOut className="h-3.5 w-3.5" />
            {t('firm.signin.signout')}
          </Button>
        </div>
      )}
    </div>
  );
}

export default FirmSignIn;
