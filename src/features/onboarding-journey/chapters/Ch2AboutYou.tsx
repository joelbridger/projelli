/**
 * Ch2AboutYou — "A bit about you"
 *
 * Collects profession (5 cards) and display name (text input).
 * Optional photo upload (stays local; data URL saved to journeyData).
 *
 * Gate: both profession and a non-empty displayName are required to advance.
 * Hooks live in the component; render is a pure function per chapter contract.
 */

/* eslint-disable keepance-i18n/no-hardcoded-string */

import { useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { Chapter, ChapterContext, JourneyData, ProfessionId } from '../engine/types';
import { JOURNEY_STRINGS } from '../copy/strings';
import { ChapterLayout } from './ChapterLayout';

const S = JOURNEY_STRINGS.ch2;

// ---------------------------------------------------------------------------
// canAdvance gate
// ---------------------------------------------------------------------------

function canAdvanceGate(data: JourneyData): boolean {
  return !!data.profession && !!data.displayName && data.displayName.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Chapter export
// ---------------------------------------------------------------------------

export const ch2AboutYou: Chapter = {
  id: 'about-you',
  title: 'About you',
  canAdvance: canAdvanceGate,
  render: (ctx) => <Ch2View ctx={ctx} />,
};

// ---------------------------------------------------------------------------
// View component
// ---------------------------------------------------------------------------

interface Ch2ViewProps {
  ctx: ChapterContext;
}

function Ch2View({ ctx }: Ch2ViewProps) {
  // Mirror ctx.data into local state so controlled inputs work correctly.
  // Changes flow back via ctx.setData immediately.
  const [profession, setProfession] = useState<ProfessionId | undefined>(ctx.data.profession);
  const [displayName, setDisplayName] = useState<string>(ctx.data.displayName ?? '');
  const photoInputRef = useRef<HTMLInputElement>(null);

  const canAdvance = !!profession && displayName.trim().length > 0;

  const handleProfession = (id: ProfessionId) => {
    setProfession(id);
    ctx.setData({ profession: id });
  };

  const handleName = (val: string) => {
    setDisplayName(val);
    ctx.setData({ displayName: val });
  };

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      ctx.setData({ photoDataUrl: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  return (
    <ChapterLayout
      title={S.title}
      onBack={ctx.goBack}
      onContinue={ctx.advance}
      continueLabel={S.continueBtn}
      continueDisabled={!canAdvance}
      testId="ch2-root"
    >
      {/* Profession question */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)' }}>
        <div>
          <p
            style={{
              fontSize: 'var(--kp-font-base)',
              fontWeight: 'var(--kp-weight-semibold)',
              color: 'var(--color-foreground)',
              margin: 0,
            }}
          >
            {S.professionQuestion}
          </p>
          <p
            style={{
              fontSize: 'var(--kp-font-sm)',
              color: 'var(--color-muted-foreground)',
              margin: '2px 0 0',
            }}
          >
            {S.professionSub}
          </p>
        </div>

        <div
          role="group"
          aria-label={S.professionQuestion}
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {S.professions.map((p) => {
            const selected = profession === p.id;
            return (
              <button
                key={p.id}
                type="button"
                data-testid={`ch2-profession-${p.id}`}
                aria-pressed={selected}
                onClick={() => handleProfession(p.id as ProfessionId)}
                className={cn(
                  'w-full rounded-lg border px-4 py-3 text-sm text-left font-medium transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-card text-foreground hover:bg-muted/30',
                )}
                style={selected ? { borderColor: 'var(--kp-navy)' } : undefined}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Name question */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label
          htmlFor="ch2-display-name"
          style={{
            fontSize: 'var(--kp-font-base)',
            fontWeight: 'var(--kp-weight-semibold)',
            color: 'var(--color-foreground)',
          }}
        >
          {S.nameQuestion}
        </label>
        <input
          id="ch2-display-name"
          type="text"
          placeholder={S.namePlaceholder}
          value={displayName}
          onChange={(e) => handleName(e.target.value)}
          data-testid="ch2-display-name"
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: 'var(--kp-font-base)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            background: 'var(--color-background)',
            color: 'var(--color-foreground)',
            outline: 'none',
          }}
        />
      </div>

      {/* Photo upload (optional) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button
          type="button"
          data-testid="ch2-add-photo"
          onClick={() => photoInputRef.current?.click()}
          style={{
            fontSize: 'var(--kp-font-sm)',
            color: 'var(--kp-navy)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          {S.photoLabel}
        </button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          data-testid="ch2-photo-input"
          onChange={handlePhoto}
        />
        <p
          style={{
            fontSize: 'var(--kp-font-xs)',
            color: 'var(--color-muted-foreground)',
            margin: 0,
          }}
        >
          {S.photoNote}
        </p>
      </div>
    </ChapterLayout>
  );
}
