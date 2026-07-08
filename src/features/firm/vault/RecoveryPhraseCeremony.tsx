/**
 * RecoveryPhraseCeremony — mandatory confirmed recovery-phrase ceremony.
 *
 * Displays the 24-word BIP39 recovery phrase with a numbered word grid,
 * a copy button, the "Lantern cannot recover this for you" warning, and
 * a confirmation step that requires the user to re-enter 3 specific words
 * before the Activate button enables.
 *
 * The 3 confirmation positions are fixed at mount (never change on re-render).
 */
import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, ShieldAlert } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';

interface RecoveryPhraseCeremonyProps {
  phrase: string;
  onConfirmed: () => void;
}

/** Pick 3 unique random positions (1-indexed) from 1..24, fixed at mount. */
function pickThreePositions(): [number, number, number] {
  const positions: number[] = [];
  while (positions.length < 3) {
    const p = Math.floor(Math.random() * 24) + 1;
    if (!positions.includes(p)) positions.push(p);
  }
  positions.sort((a, b) => a - b);
  return positions as [number, number, number];
}

export function RecoveryPhraseCeremony({ phrase, onConfirmed }: RecoveryPhraseCeremonyProps) {
  const { t } = useTranslation();
  const words = useMemo(() => phrase.split(/\s+/).filter(Boolean), [phrase]);

  // Fixed at mount — never changes on re-render
  const [positions] = useState<[number, number, number]>(pickThreePositions);

  const [copies, setCopies] = useState(false);
  const [confirmValues, setConfirmValues] = useState<Record<number, string>>({});

  const allCorrect = positions.every((pos) => {
    const expected = words[pos - 1] ?? '';
    return (confirmValues[pos] ?? '').trim() === expected;
  });

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(phrase);
      setCopies(true);
      setTimeout(() => { setCopies(false); }, 2000);
    } catch {
      /* Clipboard may be unavailable in tests */
    }
  }, [phrase]);

  return (
    <div className="flex flex-col gap-6">
      {/* Warning banner */}
      <div
        data-testid="cannot-recover-warning"
        className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4"
      >
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden />
        <p className="text-sm font-bold text-red-800">
          {t('vault.ceremony.cannot-recover-warning')}
        </p>
      </div>

      {/* 24-word grid */}
      <div>
        <p className="mb-3 text-sm font-medium text-slate-700">{t('vault.ceremony.phrase-label')}</p>
        <div className="grid grid-cols-4 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
          {words.map((word, idx) => (
            <div key={idx} className="flex items-center gap-1.5 text-sm">
              <span className="w-6 shrink-0 text-right text-xs text-slate-400">{idx + 1}.</span>
              <span className="font-mono font-medium text-slate-800">{word}</span>
            </div>
          ))}
        </div>

        {/* Copy button */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 gap-1.5 border-slate-300 text-slate-700"
          onClick={() => { void handleCopy(); }}
        >
          {copies ? (
            <><Check className="h-3.5 w-3.5 text-green-600" aria-hidden /> {t('vault.ceremony.copied')}</>
          ) : (
            <><Copy className="h-3.5 w-3.5" aria-hidden /> {t('vault.ceremony.copy-phrase')}</>
          )}
        </Button>
      </div>

      {/* Confirmation inputs */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="mb-4 text-sm font-medium text-slate-700">
          {t('vault.ceremony.confirm-prompt')}
        </p>
        <div className="flex flex-col gap-3">
          {positions.map((pos) => (
            <div key={pos} className="flex items-center gap-3">
              <Label
                htmlFor={`confirm-input-${String(pos)}`}
                className="w-24 shrink-0 text-sm text-slate-600"
              >
                {t('vault.ceremony.word-label', { pos })}
              </Label>
              <Input
                id={`confirm-input-${String(pos)}`}
                data-testid={`confirm-input-${String(pos)}`}
                placeholder={t('vault.ceremony.word-placeholder', { pos })}
                value={confirmValues[pos] ?? ''}
                onChange={(e) => {
                  setConfirmValues((prev) => ({ ...prev, [pos]: e.target.value }));
                }}
                className="max-w-48 border-slate-300 bg-white text-slate-800 placeholder:text-slate-400"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Activate button */}
      <Button
        type="button"
        disabled={!allCorrect}
        onClick={() => { if (allCorrect) onConfirmed(); }}
        className="w-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {t('vault.ceremony.activate')}
      </Button>
    </div>
  );
}
