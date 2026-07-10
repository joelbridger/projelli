import type { TFunction } from 'i18next';

import type { LinkSignal, LinkSignalKind } from '@/platform/intake/onboardingModel';

export function linkSignalLabel(kind: LinkSignalKind, t: TFunction): string {
  switch (kind) {
    case 'active':
      return t('intake.link.signal.active.badge');
    case 'expires_soon':
      return t('intake.link.signal.expires-soon.badge');
    case 'expired':
      return t('intake.link.signal.expired.badge');
    case 'revoked':
      return t('intake.link.signal.revoked.badge');
    case 'new_device':
      return t('intake.link.signal.new-device.badge');
    case 'duplicate':
      return t('intake.link.signal.duplicate.badge');
    case 'integrity_mismatch':
      return t('intake.link.signal.integrity-mismatch.badge');
    case 'routing_failed':
      return t('intake.link.signal.routing-failed.badge');
    case 'shared_intake_setup_required':
      return t('intake.link.signal.shared-intake-setup-required.badge');
    case 'regenerate_available':
      return t('intake.link.signal.regenerate-available.badge');
  }
}

export function linkSignalTitle(kind: LinkSignalKind, t: TFunction): string {
  switch (kind) {
    case 'active':
      return t('intake.link.signal.active.title');
    case 'expires_soon':
      return t('intake.link.signal.expires-soon.title');
    case 'expired':
      return t('intake.link.signal.expired.title');
    case 'revoked':
      return t('intake.link.signal.revoked.title');
    case 'new_device':
      return t('intake.link.signal.new-device.title');
    case 'duplicate':
      return t('intake.link.signal.duplicate.title');
    case 'integrity_mismatch':
      return t('intake.link.signal.integrity-mismatch.title');
    case 'routing_failed':
      return t('intake.link.signal.routing-failed.title');
    case 'shared_intake_setup_required':
      return t('intake.link.signal.shared-intake-setup-required.title');
    case 'regenerate_available':
      return t('intake.link.signal.regenerate-available.title');
  }
}

export function linkSignalBody(kind: LinkSignalKind, t: TFunction): string {
  switch (kind) {
    case 'active':
      return t('intake.link.signal.active.body');
    case 'expires_soon':
      return t('intake.link.signal.expires-soon.body');
    case 'expired':
      return t('intake.link.signal.expired.body');
    case 'revoked':
      return t('intake.link.signal.revoked.body');
    case 'new_device':
      return t('intake.link.signal.new-device.body');
    case 'duplicate':
      return t('intake.link.signal.duplicate.body');
    case 'integrity_mismatch':
      return t('intake.link.signal.integrity-mismatch.body');
    case 'routing_failed':
      return t('intake.link.signal.routing-failed.body');
    case 'shared_intake_setup_required':
      return t('intake.link.signal.shared-intake-setup-required.body');
    case 'regenerate_available':
      return t('intake.link.signal.regenerate-available.body');
  }
}

export function linkSignalAction(kind: LinkSignalKind, t: TFunction): string {
  switch (kind) {
    case 'active':
      return t('intake.link.signal.active.action');
    case 'expires_soon':
      return t('intake.link.signal.expires-soon.action');
    case 'expired':
      return t('intake.link.signal.expired.action');
    case 'revoked':
      return t('intake.link.signal.revoked.action');
    case 'new_device':
      return t('intake.link.signal.new-device.action');
    case 'duplicate':
      return t('intake.link.signal.duplicate.action');
    case 'integrity_mismatch':
      return t('intake.link.signal.integrity-mismatch.action');
    case 'routing_failed':
      return t('intake.link.signal.routing-failed.action');
    case 'shared_intake_setup_required':
      return t('intake.link.signal.shared-intake-setup-required.action');
    case 'regenerate_available':
      return t('intake.link.signal.regenerate-available.action');
  }
}

export function linkSignalKey(signal: LinkSignal): string {
  return `${signal.kind}:${signal.at ?? 'none'}`;
}

export function isPrimaryLinkSignal(kind: LinkSignalKind): boolean {
  return (
    kind === 'active' ||
    kind === 'expires_soon' ||
    kind === 'expired' ||
    kind === 'revoked'
  );
}
