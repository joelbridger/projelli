/**
 * Ch6Email — "Bring in your email"
 *
 * Three provider tabs (Microsoft 365 / Gmail / Other) that embed the real
 * MailConnect / MailGmailConnect / MailImapConnect components exactly as
 * GuidedOnboarding's email step does — no restyling, just mounted inside
 * the journey layout.
 *
 * The mail connector components manage their own state and call Tauri
 * commands directly; they do not expose an "onConnected" callback. So Ch6
 * follows the same pattern as GuidedOnboarding: after a user completes the
 * OAuth flow in the connector, they click "Continue" to advance, and we
 * record emailConnected = true. "Connect later" advances without setting the
 * flag. This mirrors exactly how GuidedOnboarding step 6 works.
 */

/* eslint-disable keepance-i18n/no-hardcoded-string */

import { useState } from 'react';
import { Button } from '@/ui/kp';
import type { Chapter, ChapterContext } from '../engine/types';
import {
  SceneFrame,
  House,
  Papers,
  PaperPlane,
} from '../scenes';
import { JOURNEY_STRINGS } from '../copy/strings';

import { MailConnect } from '@/features/settings/MailConnect';
import { MailGmailConnect } from '@/features/settings/MailGmailConnect';
import { MailImapConnect } from '@/features/settings/MailImapConnect';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EmailTab = 'm365' | 'gmail' | 'imap';

const EMAIL_TABS: { id: EmailTab; label: string }[] = [
  { id: 'm365', label: 'Microsoft 365' },
  { id: 'gmail', label: 'Gmail' },
  { id: 'imap', label: 'Other (IMAP)' },
];

const S = JOURNEY_STRINGS.ch6;

// ---------------------------------------------------------------------------
// Chapter export
// ---------------------------------------------------------------------------

export const ch6Email: Chapter = {
  id: 'email',
  title: 'Email',
  render: (ctx) => <Ch6View ctx={ctx} />,
};

// ---------------------------------------------------------------------------
// View component (all hooks live here)
// ---------------------------------------------------------------------------

interface Ch6ViewProps {
  ctx: ChapterContext;
}

function Ch6View({ ctx }: Ch6ViewProps) {
  const [tab, setTab] = useState<EmailTab>('m365');

  const scene = (
    <SceneFrame label={S.sceneLabel}>
      <div style={{ position: 'relative', width: 120, height: 100 }}>
        <div style={{ position: 'absolute', bottom: 0, left: 0 }}>
          <House reducedMotion={ctx.reducedMotion} size={76} />
        </div>
        <div style={{ position: 'absolute', top: 0, right: 0 }}>
          <PaperPlane reducedMotion={ctx.reducedMotion} size={36} />
        </div>
        <div style={{ position: 'absolute', bottom: 10, right: 2 }}>
          <Papers reducedMotion={ctx.reducedMotion} size={32} />
        </div>
      </div>
    </SceneFrame>
  );

  return (
    <div data-testid="ch6-root">
      {/* Scene */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--kp-space-xl)' }}>
        {scene}
      </div>

      {/* Title */}
      <h2
        style={{
          fontSize: 'var(--kp-font-2xl)',
          fontWeight: 'var(--kp-weight-bold)',
          color: 'var(--kp-navy)',
          margin: '0 0 var(--kp-space-md)',
          lineHeight: 1.2,
        }}
      >
        {S.title}
      </h2>

      {/* Body */}
      <p
        style={{
          fontSize: 'var(--kp-font-base)',
          color: 'var(--color-foreground)',
          margin: '0 0 var(--kp-space-lg)',
          lineHeight: 1.6,
        }}
      >
        {S.body}
      </p>

      {/* Provider tabs */}
      <div
        role="tablist"
        aria-label="Email provider"
        style={{ display: 'flex', gap: 6, marginBottom: 20 }}
      >
        {EMAIL_TABS.map(({ id, label }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`ch6-tab-${id}`}
              onClick={() => { setTab(id); }}
              style={{
                flex: 1,
                borderRadius: 8,
                padding: '7px 10px',
                fontSize: 13,
                fontWeight: 600,
                border: active
                  ? '1.5px solid var(--kp-navy)'
                  : '1.5px solid hsl(214.3 31.8% 60%)',
                background: active ? 'rgba(10,37,64,0.07)' : '#fff',
                color: active ? 'var(--kp-navy)' : 'hsl(215.4 16.3% 44%)',
                cursor: 'pointer',
                transition: 'border-color 0.12s, background 0.12s',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Real Mail* components — mounted as-is, no restyling */}
      <div style={{ marginBottom: 20 }} data-testid="ch6-connector-panel">
        {tab === 'm365' && <MailConnect />}
        {tab === 'gmail' && <MailGmailConnect />}
        {tab === 'imap' && <MailImapConnect />}
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 'var(--kp-space-md)',
          borderTop: '1px solid var(--color-border)',
          gap: 'var(--kp-space-md)',
        }}
      >
        <Button
          variant="ghost"
          onClick={ctx.goBack}
          data-testid="chapter-back"
        >
          Back
        </Button>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button
            variant="secondary"
            onClick={() => { ctx.advance(); }}
            data-testid="ch6-connect-later"
          >
            {S.connectLaterBtn}
          </Button>

          <Button
            variant="primary"
            onClick={() => {
              ctx.setData({ emailConnected: true });
              ctx.advance();
            }}
            data-testid="ch6-continue"
          >
            {S.continueBtn}
          </Button>
        </div>
      </div>
    </div>
  );
}
