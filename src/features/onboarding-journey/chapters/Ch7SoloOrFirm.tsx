/**
 * Ch7SoloOrFirm — "Just you, or a team?"
 *
 * Captures firmChoice into JourneyData only. Does NOT make any backend calls.
 * The note on screen makes this honest: the user can change the setting later
 * in Settings, where the real firm provisioning lives.
 *
 * Options:
 *   'solo'   — I work solo (default, pre-selected)
 *   'create' — Create a firm
 *   'join'   — Join a firm (shows an invite-code text field)
 */

/* eslint-disable keepance-i18n/no-hardcoded-string */

import { useState } from 'react';
import type { Chapter, ChapterContext, FirmChoice } from '../engine/types';
import {
  SceneFrame,
  House,
  Lock,
} from '../scenes';
import { JOURNEY_STRINGS } from '../copy/strings';
import { ChapterLayout } from './ChapterLayout';

const S = JOURNEY_STRINGS.ch7;

// ---------------------------------------------------------------------------
// Chapter export
// ---------------------------------------------------------------------------

export const ch7SoloOrFirm: Chapter = {
  id: 'firm',
  title: 'Team',
  render: (ctx) => <Ch7View ctx={ctx} />,
};

// ---------------------------------------------------------------------------
// View component (all hooks live here)
// ---------------------------------------------------------------------------

interface Ch7ViewProps {
  ctx: ChapterContext;
}

const OPTIONS: { id: FirmChoice; label: string; description: string }[] = [
  {
    id: 'solo',
    label: S.soloLabel,
    description: S.soloDescription,
  },
  {
    id: 'create',
    label: S.createLabel,
    description: S.createDescription,
  },
  {
    id: 'join',
    label: S.joinLabel,
    description: S.joinDescription,
  },
];

function Ch7View({ ctx }: Ch7ViewProps) {
  const [choice, setChoice] = useState<FirmChoice>(
    (ctx.data.firmChoice as FirmChoice | undefined) ?? 'solo',
  );
  const [inviteCode, setInviteCode] = useState(ctx.data.firmInviteCode ?? '');

  const scene = (
    <SceneFrame label={S.sceneLabel}>
      <div style={{ position: 'relative', width: 120, height: 90 }}>
        {/* Solo house (left) */}
        <div style={{ position: 'absolute', bottom: 0, left: 0 }}>
          <House reducedMotion={ctx.reducedMotion} size={58} />
        </div>
        {/* Shared firm houses (right, smaller) */}
        <div style={{ position: 'absolute', bottom: 0, right: 18 }}>
          <House reducedMotion={ctx.reducedMotion} size={44} />
        </div>
        <div style={{ position: 'absolute', bottom: 0, right: 0 }}>
          <House reducedMotion={ctx.reducedMotion} size={36} />
        </div>
        {/* Shared lock */}
        <div style={{ position: 'absolute', top: 2, right: 2 }}>
          <Lock reducedMotion={ctx.reducedMotion} size={22} />
        </div>
      </div>
    </SceneFrame>
  );

  const handleContinue = () => {
    ctx.setData({ firmChoice: choice });
    if (choice === 'join' && inviteCode.trim()) {
      ctx.setData({ firmInviteCode: inviteCode.trim() });
    }
    ctx.advance();
  };

  return (
    <ChapterLayout
      title={S.title}
      scene={scene}
      onBack={ctx.goBack}
      onContinue={handleContinue}
      testId="ch7-root"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {OPTIONS.map((opt) => {
          const selected = choice === opt.id;
          const isJoin = opt.id === 'join';
          return (
            <div key={opt.id}>
              <button
                type="button"
                data-testid={`ch7-option-${opt.id}`}
                onClick={() => { setChoice(opt.id); }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  borderRadius: selected && isJoin ? '8px 8px 0 0' : 8,
                  border: selected
                    ? '2px solid var(--kp-navy)'
                    : '1.5px solid hsl(214.3 31.8% 60%)',
                  padding: '12px 14px',
                  cursor: 'pointer',
                  background: selected ? 'rgba(10,37,64,0.06)' : '#fff',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'hsl(222.2 84% 4.9%)',
                    margin: '0 0 3px',
                  }}
                >
                  {opt.label}
                </p>
                <p
                  style={{
                    fontSize: 12,
                    color: 'hsl(215.4 16.3% 44%)',
                    lineHeight: 1.45,
                    margin: 0,
                  }}
                >
                  {opt.description}
                </p>
              </button>

              {/* Invite-code field expands below the Join card */}
              {isJoin && selected && (
                <div
                  style={{
                    border: '2px solid var(--kp-navy)',
                    borderTop: 'none',
                    borderRadius: '0 0 8px 8px',
                    padding: '12px 14px',
                    background: '#fff',
                  }}
                >
                  <label
                    htmlFor="ch7-invite-code"
                    style={{
                      display: 'block',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'hsl(222.2 84% 4.9%)',
                      marginBottom: 6,
                    }}
                  >
                    {S.inviteCodeLabel}
                  </label>
                  <input
                    id="ch7-invite-code"
                    type="text"
                    value={inviteCode}
                    onChange={(e) => { setInviteCode(e.target.value); }}
                    placeholder={S.inviteCodePlaceholder}
                    data-testid="ch7-invite-code-input"
                    style={{
                      width: '100%',
                      border: '1.5px solid hsl(214.3 31.8% 70%)',
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: 13,
                      color: 'var(--kp-navy)',
                      fontFamily: 'var(--font-sans)',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Honest note */}
      <p
        style={{
          fontSize: 12,
          color: 'hsl(215.4 16.3% 44%)',
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        {S.changeNote}
      </p>
    </ChapterLayout>
  );
}
