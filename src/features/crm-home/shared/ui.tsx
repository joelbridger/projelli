import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard } from 'lucide-react';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import type { CrmFreshnessState } from '../types';

export const panelStyle = {
  border: '1px solid var(--kp-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)',
  padding: 'var(--kp-space-md)',
} as const;

export const mutedStyle = {
  color: 'var(--kp-text-faint)',
  fontSize: 'var(--kp-font-sm)',
} as const;

export function FreshnessBanner({ freshness }: { freshness: CrmFreshnessState }) {
  const { t } = useTranslation();
  const marker = freshness.kind === 'live' ? '● Live' : freshness.kind === 'syncing' ? '◌ Syncing' : freshness.kind === 'offline' ? `☁ ${t('crm.offline.message')}` : freshness.kind === 'last-synced' ? '● Last synced' : '● Needs attention';
  const color = freshness.kind === 'live' ? 'var(--kp-local)' : freshness.kind === 'syncing' ? 'var(--kp-assured)' : freshness.kind === 'offline' ? 'var(--color-slate-500)' : freshness.kind === 'last-synced' ? 'var(--kp-direct)' : 'var(--kp-danger)';
  const detail = freshness.kind === 'syncing'
    ? `Showing at least the changes received through ${freshness.lastSyncedAt ?? 'the last update'}; newer changes may still arrive.`
    : freshness.kind === 'offline'
      ? null
      : freshness.kind === 'last-synced'
        ? `Last synced ${freshness.lastSyncedAt ?? 'previously'} · Full check: ${freshness.lastFullCheckAt ?? 'not available'}`
        : freshness.kind === 'error'
          ? (freshness.error ?? 'A specific connection check needs attention. Your readable local data remains available.')
          : 'Every contributing subscription has caught up.';
  return <div data-testid="crm-freshness-banner" role="status" style={{ ...panelStyle, padding: 'var(--kp-space-sm)', borderColor: color, display: 'flex', gap: 'var(--kp-space-sm)', alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ color }}>{marker}</strong>{detail ? <span style={mutedStyle}>{detail}</span> : null}</div>;
}

export function AskBar({ scope = 'the firm' }: { scope?: string }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 260, border: '1px solid var(--kp-border)', borderRadius: 8, padding: '7px 10px', background: 'white' }}><span aria-hidden="true">✦</span><input data-testid="crm-ask-input" aria-label={`Ask ${scope}`} placeholder={`Ask ${scope}…`} style={{ border: 0, outline: 0, width: '100%', font: 'inherit', background: 'transparent' }} /></label>;
}

export function Screen({ title, description, Icon, action, children }: { title: string; description: string; Icon: typeof LayoutDashboard; action?: ReactNode; children: ReactNode }) {
  return <div data-testid={`crm-screen-${title.toLowerCase().replaceAll(' ', '-')}`} style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)' }}><SurfaceHeader Icon={Icon} title={title} description={description} actions={action} />{children}</div>;
}
