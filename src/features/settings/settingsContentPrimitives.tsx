// Extracted from SettingsContent.tsx — self-contained primitive UI sub-components.
// None of these close over the parent component's state or handlers.

import { useTranslation } from 'react-i18next';
import { Input } from '@/ui/input';
import { IconButton } from '@/ui/kp';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { BRAND } from '@/config/brand';

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

export function Toggle({
  checked,
  onChange,
  id,
  testid,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
  testid?: string;
}) {
  return (
    <button
      id={id}
      data-testid={testid}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => { onChange(!checked); }}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        checked ? 'bg-primary' : 'bg-muted'
      )}
    >
      <span
        className={cn(
          'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Number input with +/- steppers
// ---------------------------------------------------------------------------

export function NumberStepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  id,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
}) {
  const clamp = (v: number) => {
    let n = v;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };

  return (
    <div className="flex items-center gap-1">
      <IconButton
        icon={ChevronDown}
        label="Decrease"
        variant="secondary"
        size="sm"
        onClick={() => { onChange(clamp(value - step)); }}
        disabled={min !== undefined && value <= min}
      />
      <Input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (!isNaN(parsed)) onChange(clamp(parsed));
        }}
        className="w-24 h-8 text-center text-sm"
      />
      <IconButton
        icon={ChevronUp}
        label="Increase"
        variant="secondary"
        size="sm"
        onClick={() => { onChange(clamp(value + step)); }}
        disabled={max !== undefined && value >= max}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// About header
// ---------------------------------------------------------------------------

export function AboutHeader() {
  const { t } = useTranslation();
  const version =
    (import.meta.env['VITE_APP_VERSION'] as string | undefined) ?? '?';
  return (
    <div
      data-testid="settings-about-header"
      className="mb-4 pb-4 border-b border-border/50"
    >
      <div className="flex items-baseline gap-2">
        <h3 className="text-base font-semibold">{BRAND.name}</h3>
        <span className="text-sm text-muted-foreground" data-testid="settings-about-version">
          v{version}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {t('settings.modal.about-tagline')}
      </p>
    </div>
  );
}
