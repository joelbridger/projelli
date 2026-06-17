/**
 * VG-6d-v1 — disk-encryption guidance. Keepance stores documents as normal
 * files; at-rest protection comes from the OS's full-disk encryption. This
 * callout makes that explicit and tells the user how to CHECK it is on,
 * per platform. The encrypted workspace vault (VG-6d-v2) supersedes the
 * caveat later; the guidance stays true either way.
 */
import { useTranslation } from 'react-i18next';
import { HardDrive } from 'lucide-react';

export type DesktopPlatform = 'windows' | 'macos' | 'linux';

export function detectDesktopPlatform(): DesktopPlatform {
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '').toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  return 'windows';
}

export function DiskEncryptionGuidance() {
  const { t } = useTranslation();
  const platform = detectDesktopPlatform();
  return (
    <div
      data-testid="disk-encryption-guidance"
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <div className="flex items-center gap-2 font-medium">
        <HardDrive className="h-4 w-4 shrink-0" aria-hidden />
        {t('onboarding.disk-encryption.title')}
      </div>
      <p className="mt-1.5">{t('onboarding.disk-encryption.body')}</p>
      <p className="mt-1.5 font-medium" data-testid={`disk-encryption-check-${platform}`}>
        {t(`onboarding.disk-encryption.check-${platform}`)}
      </p>
    </div>
  );
}
