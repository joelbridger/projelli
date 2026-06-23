/**
 * UseWithFirmFlow — the "Use this with my firm" guided front door.
 *
 * A small state machine that frames the EXISTING firm auth so a solo user can
 * get into a firm and bring their matters over in one flow:
 *
 *   choose  -> two co-equal doors: start/lead a firm vs join an existing firm
 *   auth    -> the existing FirmSignIn, opened in claim (create) or sign-in (join)
 *   carry   -> the guided per-matter carry-over (CarryMattersStep)
 *
 * The flow adds framing and a clean entry, not new auth or crypto. It reuses
 * FirmSignIn (claim/seat activation) and CarryMattersStep (which reuses the
 * proven promote routine). When a firm seat is already active the flow skips
 * straight to the carry-over step. No em dashes; honest, first-person copy.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, UserPlus, ChevronLeft } from 'lucide-react';
import { Button } from '@/ui/button';
import { useFirm } from '@/platform/hooks/useFirm';
import { FirmSignIn } from '@/features/firm/FirmSignIn';
import { CarryMattersStep } from '@/features/firm/CarryMattersStep';

export interface UseWithFirmFlowProps {
  onClose: () => void;
}

/** Canonical firm-plan purchase link (matches LicenseSettings). */
const FIRM_PLAN_URL = 'https://keepance.com/#pricing';

type Stage = 'choose' | 'auth' | 'carry';
type Door = 'create' | 'join';

export function UseWithFirmFlow({ onClose }: UseWithFirmFlowProps) {
  const { t } = useTranslation();
  const firm = useFirm();
  const hasSeat = firm.isSignedIn && firm.hasActiveSeat;

  // Only the pre-seat navigation is local state: which of the two doors and
  // whether we are still choosing or already in the auth panel. We never store
  // the carry stage; it is DERIVED from the firm session below, so the moment a
  // seat becomes active (claim/activate succeeds, or the flow opens with one
  // already active) we advance to the carry-over step with no effect/setState
  // in render. This is the post-seat trigger.
  const [localStage, setLocalStage] = useState<'choose' | 'auth'>('choose');
  const [door, setDoor] = useState<Door>('create');

  const stage: Stage = hasSeat ? 'carry' : localStage;

  const finish = () => {
    onClose();
  };

  if (stage === 'carry') {
    return (
      <div data-testid="use-with-firm-flow">
        <CarryMattersStep onDone={finish} onSkip={finish} />
      </div>
    );
  }

  if (stage === 'auth') {
    return (
      <div data-testid="use-with-firm-flow" className="space-y-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          data-testid="firm-auth-back"
          onClick={() => {
            setLocalStage('choose');
          }}
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          {t('firm.bridge.back')}
        </Button>
        {door === 'create' && (
          <p data-testid="firm-create-paid-note" className="text-xs text-muted-foreground">
            {t('firm.bridge.create-paid-note')}{' '}
            <a
              href={FIRM_PLAN_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline"
            >
              {t('firm.bridge.create-paid-link')}
            </a>
          </p>
        )}
        <FirmSignIn initialPanel={door === 'create' ? 'claim' : 'signin'} />
      </div>
    );
  }

  // stage === 'choose'
  return (
    <div data-testid="use-with-firm-flow" className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{t('firm.bridge.heading')}</h2>
        <p className="text-sm text-muted-foreground">{t('firm.bridge.intro')}</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          data-testid="firm-door-create"
          onClick={() => {
            setDoor('create');
            setLocalStage('auth');
          }}
          className="flex flex-col items-start gap-2 rounded-lg border border-border/70 p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
        >
          <Building2 className="h-5 w-5 text-primary" aria-hidden />
          <span className="font-medium">{t('firm.bridge.door-create-title')}</span>
          <span className="text-xs text-muted-foreground">
            {t('firm.bridge.door-create-body')}
          </span>
        </button>
        <button
          type="button"
          data-testid="firm-door-join"
          onClick={() => {
            setDoor('join');
            setLocalStage('auth');
          }}
          className="flex flex-col items-start gap-2 rounded-lg border border-border/70 p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
        >
          <UserPlus className="h-5 w-5 text-primary" aria-hidden />
          <span className="font-medium">{t('firm.bridge.door-join-title')}</span>
          <span className="text-xs text-muted-foreground">
            {t('firm.bridge.door-join-body')}
          </span>
        </button>
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="ghost" data-testid="firm-bridge-close" onClick={finish}>
          {t('firm.bridge.cancel')}
        </Button>
      </div>
    </div>
  );
}
