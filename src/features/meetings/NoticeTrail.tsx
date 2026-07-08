/**
 * Recording Notice Kit — the meeting-page notice trail (Piece 1/2/3 surface).
 *
 * Shows, compactly, the provable notice trail for one meeting:
 *   - verified spoken notice → a chip ("Notice verified at 0:14") + the snippet;
 *   - no notice detected → an honest, non-accusatory needs-review block with
 *     one-click resolutions (Standard) OR a quarantine banner (Strict);
 *   - resolved → what the human recorded;
 *   - always: one-click "Copy invite disclosure" / "Copy chat notice" actions,
 *     each writing a self-attested ledger entry.
 *
 * Presentational + injected: it takes the meeting's notice entries and an
 * `onRecordNotice` sink, so it's plain-testable without a workspace. The
 * verification itself is fully local (see noticeVerification.ts).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, AlertTriangle, Copy, Check, Info, ChevronDown, ChevronRight, MoreVertical } from 'lucide-react';
import { Badge, Callout } from '@/ui/kp';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { deriveNoticeState, type NoticeEntry, type NoticeResolution } from './noticeLedger';
import type { NoticePolicy } from './noticeSettings';
import { copyText as defaultCopyText } from './noticeClipboard';

export interface NoticeTrailProps {
  meetingDir: string;
  notices: NoticeEntry[];
  policy: NoticePolicy;
  /** Localized disclosure text for the invite (advance notice). */
  inviteDisclosure: string;
  /** Localized notice text for the meeting chat. */
  chatNotice: string;
  /** Append a notice entry to the ledger; the parent re-reads and updates
   *  `notices`. */
  onRecordNotice: (entry: NoticeEntry) => Promise<void> | void;
  /** Injectable clock for deterministic tests. */
  now?: () => string;
  /** Injectable clipboard writer for tests. */
  copyText?: (text: string) => Promise<void>;
}

/** ms → "m:ss" (the audio timestamp the notice was spoken at). */
function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m)}:${String(s).padStart(2, '0')}`;
}

export function NoticeTrail({ meetingDir, notices, policy, inviteDisclosure, chatNotice, onRecordNotice, now, copyText, }: NoticeTrailProps) {
  const { t } = useTranslation();
  const state = deriveNoticeState(notices);
  const clock = now ?? (() => new Date().toISOString());
  const doCopy = copyText ?? defaultCopyText;
  const [copied, setCopied] = useState<'invite' | 'chat' | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const resolve = (resolution: NoticeResolution) => {
    void onRecordNotice({ kind: 'notice-review-resolved', meetingDir, at: clock(), resolution });
  };

  // Literal t() keys (kept out of a lookup map so the i18n extractor sees them).
  const resolvedHow = (resolution: NoticeResolution): string => {
    switch (resolution) {
      case 'disclosed-in-advance': return t('meetings.notice.resolved-disclosed');
      case 'transcription-missed': return t('meetings.notice.resolved-missed');
      case 'acknowledged-gap': return t('meetings.notice.resolved-ack');
    }
  };

  const handleCopy = (which: 'invite' | 'chat') => {
    void (async () => {
      const text = which === 'invite' ? inviteDisclosure : chatNotice;
      try {
        await doCopy(text); // throws if the copy wasn't confirmed
      } catch {
        // The copy failed — do NOT record a ledger entry or show "Copied",
        // which would be false compliance evidence (codex-review R5).
        return;
      }
      await onRecordNotice(
        which === 'invite'
          ? { kind: 'invite-disclosure-copied', meetingDir, at: clock(), text }
          : { kind: 'chat-notice-copied', meetingDir, at: clock(), text },
      );
      setCopied(which);
      window.setTimeout(() => { setCopied((c) => (c === which ? null : c)); }, 1500);
    })();
  };

  const resolutionButtons = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--kp-space-sm)', marginTop: 'var(--kp-space-sm)' }}>
      <button type="button" data-testid="notice-resolve-disclosed" onClick={() => { resolve('disclosed-in-advance'); }} style={resolveBtnStyle}>
        {t('meetings.notice.resolve-disclosed')}
      </button>
      <button type="button" data-testid="notice-resolve-missed" onClick={() => { resolve('transcription-missed'); }} style={resolveBtnStyle}>
        {t('meetings.notice.resolve-missed')}
      </button>
      <button type="button" data-testid="notice-resolve-ack" onClick={() => { resolve('acknowledged-gap'); }} style={resolveBtnStyle}>
        {t('meetings.notice.resolve-ack')}
      </button>
    </div>
  );

  const resolutionMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="notice-resolve-menu"
          aria-label={t('meetings.notice.resolve-menu')}
          title={t('meetings.notice.resolve-menu')}
          style={menuBtnStyle}
        >
          <MoreVertical aria-hidden="true" style={{ width: 14, height: 14 }} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem data-testid="notice-resolve-disclosed" onClick={() => { resolve('disclosed-in-advance'); }}>
          {t('meetings.notice.resolve-disclosed')}
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="notice-resolve-missed" onClick={() => { resolve('transcription-missed'); }}>
          {t('meetings.notice.resolve-missed')}
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="notice-resolve-ack" onClick={() => { resolve('acknowledged-gap'); }}>
          {t('meetings.notice.resolve-ack')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Copy actions + local note — the notice tools that matter most before/during
  // a meeting. Kept visible while the notice needs action; tucked inside Details
  // once a meeting is verified/resolved (item 5).
  const copyActions = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--kp-space-sm)' }}>
        <button
          type="button"
          data-testid="notice-copy-invite"
          onClick={() => { handleCopy('invite'); }}
          style={copyBtnStyle}
        >
          {copied === 'invite' ? <Check style={iconStyle} /> : <Copy style={iconStyle} />}
          {copied === 'invite' ? t('meetings.notice.copied') : t('meetings.notice.copy-invite')}
        </button>
        <button
          type="button"
          data-testid="notice-copy-chat"
          onClick={() => { handleCopy('chat'); }}
          style={copyBtnStyle}
        >
          {copied === 'chat' ? <Check style={iconStyle} /> : <Copy style={iconStyle} />}
          {copied === 'chat' ? t('meetings.notice.copied') : t('meetings.notice.copy-chat')}
        </button>
      </div>
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: 5, fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
        <Info aria-hidden="true" style={{ width: 12, height: 12, flex: 'none', marginTop: 1 }} />
        {t('meetings.notice.local-note')}
      </span>
    </div>
  );

  // A verified or resolved meeting collapses to one slim status row with the
  // details/tools on demand (item 5); a meeting that still needs action keeps
  // its warning block fully expanded (protected trust UI).
  if (state.status === 'verified' || state.status === 'resolved') {
    return (
      <div
        data-testid="notice-trail"
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)', padding: '10px var(--kp-gutter)', borderTop: '1px solid var(--kp-divider)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <ShieldCheck aria-hidden="true" style={{ width: 14, height: 14, color: 'var(--kp-success)', flex: 'none' }} />
          {state.status === 'verified' ? (
            <span data-testid="notice-verified-chip" style={{ display: 'inline-flex', alignItems: 'center' }}>
              <Badge variant="success" size="sm">
                {t('meetings.notice.verified-chip', { time: formatMs(state.atMs) })}
              </Badge>
            </span>
          ) : (
            <span data-testid="notice-resolved" style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
              {t('meetings.notice.resolved-note', { how: resolvedHow(state.resolution) })}
            </span>
          )}
          <button
            type="button"
            data-testid="notice-details-toggle"
            aria-expanded={detailsOpen}
            onClick={() => { setDetailsOpen((open) => !open); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', fontFamily: 'inherit' }}
          >
            {detailsOpen ? <ChevronDown style={iconStyle} /> : <ChevronRight style={iconStyle} />}
            {t('meetings.notice.details')}
          </button>
        </div>
        {detailsOpen && (
          <div data-testid="notice-details" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)' }}>
            {state.status === 'verified' && (
              <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
                {t('meetings.notice.verified-detail', { snippet: state.snippet })}
              </span>
            )}
            {copyActions}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="notice-trail"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)', padding: '10px var(--kp-gutter)', borderTop: '1px solid var(--kp-divider)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--kp-font-xs)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
        <ShieldCheck aria-hidden="true" style={{ width: 14, height: 14 }} />
        {t('meetings.notice.trail-heading')}
      </div>

      {state.status === 'unverified' && policy === 'standard' && (
        <div data-testid="notice-unverified" style={quietNoticeStyle}>
          <AlertTriangle aria-hidden="true" style={{ width: 14, height: 14, color: 'var(--kp-warning)', flex: 'none' }} />
          <span style={{ minWidth: 0, flex: 1, color: 'var(--kp-navy)', fontSize: 'var(--kp-font-xs)', lineHeight: 1.35 }}>
            {t('meetings.notice.unverified-title')}
          </span>
          {resolutionMenu}
        </div>
      )}

      {state.status === 'unverified' && policy === 'strict' && (
        <div data-testid="notice-quarantine">
          <Callout variant="error" icon={AlertTriangle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Badge variant="warning" size="sm">{t('meetings.notice.quarantine-badge')}</Badge>
              <span style={{ fontWeight: 'var(--kp-weight-semibold)' }}>{t('meetings.notice.quarantine-title')}</span>
            </div>
            <div style={{ marginTop: 2, fontSize: 'var(--kp-font-xs)' }}>{t('meetings.notice.quarantine-body')}</div>
            {resolutionButtons}
          </Callout>
        </div>
      )}

      {copyActions}
    </div>
  );
}

const resolveBtnStyle: React.CSSProperties = {
  border: '1px solid var(--kp-divider)', background: 'transparent', borderRadius: 'var(--radius-md)',
  padding: '6px 10px', fontSize: 'var(--kp-font-xs)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--kp-navy)',
};
const copyBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--kp-divider)',
  background: 'transparent', borderRadius: 'var(--radius-md)', padding: '6px 10px',
  fontSize: 'var(--kp-font-xs)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--kp-navy)',
};
const quietNoticeStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  border: '1px solid var(--kp-divider)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-background)',
  padding: '7px 8px',
};
const menuBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  border: '1px solid var(--kp-divider)',
  borderRadius: 'var(--radius-md)',
  background: 'transparent',
  color: 'var(--color-muted-foreground)',
  cursor: 'pointer',
  flex: 'none',
};
const iconStyle: React.CSSProperties = { width: 12, height: 12 };

export default NoticeTrail;
