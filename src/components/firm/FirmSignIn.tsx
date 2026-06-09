/**
 * FirmSignIn — the opt-in firm sign-in + seat activation surface.
 *
 * Solo/local mode is unchanged and accountless; this panel is shown only to a
 * firm customer (Settings → Firm). It covers:
 *   - sign in (email + password) -> tokens stored in the OS keychain
 *   - activate a seat with the firm license key -> seat token stored + verified
 *     offline against the seat public key
 *   - show the firm, the seat, and the live seat status (active / offline / lapsed)
 *   - sign out (clears keychain secrets)
 *
 * Light-theme first; no em dashes. No secrets ever rendered or logged.
 */
/* eslint-disable keepance-i18n/no-hardcoded-string */

import { useState } from 'react';
import { Building2, LogIn, LogOut, ShieldCheck, KeyRound, WifiOff, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useFirm } from '@/hooks/useFirm';
import type { SeatLimitExceededResponse } from '@/modules/firm/contract';

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

export function FirmSignIn() {
  const firm = useFirm();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [machineLabel, setMachineLabel] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [seatLimit, setSeatLimit] = useState<SeatLimitExceededResponse | null>(null);

  const onSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    void (async () => {
      const res = await firm.signIn(email, password);
      if (!res.ok) setLocalError(res.error ?? 'Sign-in failed.');
      else setPassword('');
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
          <h3 className="text-sm font-medium">Firm account</h3>
        </div>
        {firm.isSignedIn && <StatusPill entitlement={firm.entitlement} isOffline={firm.isOffline} />}
      </div>

      {!firm.isSignedIn ? (
        <form onSubmit={onSignIn} className="space-y-3 max-w-md">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Sign in to your firm to activate a seat and collaborate on shared
            matters. Solo use needs no account and stays fully local.
          </p>
          <div className="space-y-1">
            <Label htmlFor="firm-email" className="text-xs">Work email</Label>
            <Input
              id="firm-email"
              data-testid="firm-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => { setEmail(e.target.value); }}
              placeholder="you@firm.com"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="firm-password" className="text-xs">Password</Label>
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
          <Button type="submit" data-testid="firm-signin-submit" disabled={firm.isLoading} className="gap-1.5">
            <LogIn className="h-4 w-4" />
            {firm.isLoading ? 'Signing in...' : 'Sign in'}
          </Button>
          {(localError || firm.error) && (
            <p data-testid="firm-error" className="text-xs text-rose-700 dark:text-rose-300">
              {localError ?? firm.error}
            </p>
          )}
        </form>
      ) : (
        <div className="space-y-4 max-w-md">
          <div className="rounded-lg border border-border p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Signed in as</span>
              <span data-testid="firm-email-display" className="font-medium">{firm.email}</span>
            </div>
            {firm.org && (
              <div className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground">Firm</span>
                <span data-testid="firm-org-name" className="font-medium">{firm.org.name}</span>
              </div>
            )}
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">Role</span>
              <span className="font-medium capitalize">{firm.role}</span>
            </div>
            {firm.seatId && (
              <div className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground">Seat</span>
                <span data-testid="firm-seat-id" className="font-mono text-[11px]">{firm.seatId.slice(0, 8)}</span>
              </div>
            )}
          </div>

          {!firm.hasActiveSeat && (
            <form onSubmit={onActivate} className="space-y-3 rounded-lg border border-sky-200 dark:border-sky-900/60 p-3">
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
            Sign out
          </Button>
        </div>
      )}
    </div>
  );
}

export default FirmSignIn;
