/**
 * LanguagePicker — picks the UI language and persists the override.
 *
 * Three supported locales for v2.0: en / es / de. Option labels are shown in
 * each language's own script so users recognise their language even when the
 * app currently displays a different one.
 *
 * On change:
 *   1. `i18n.changeLanguage(lang)` updates the live UI (no reload required).
 *   2. `setLanguage(lang)` persists the override in the settings store so the
 *      next launch skips OS detection.
 *   3. Emits an `language_changed` audit event with `{ from, to }`.
 *
 * Special case: Tests can pass an explicit `auditService` to avoid
 * instantiating one against real localStorage. In production the picker
 * defaults to a workspace-scoped instance.
 */

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/ui/label';
import { InfoHelp } from '@/ui/InfoHelp';
import i18n from '@/i18n';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { AuditService } from '@/platform/audit/AuditService';

type SupportedLocale = 'en' | 'es' | 'de';

const LOCALE_OPTIONS: SupportedLocale[] = ['en', 'es', 'de'];

interface LanguagePickerProps {
  /** Optional override for tests; defaults to a default-workspace instance. */
  auditService?: AuditService;
}

function isSupported(lang: string): lang is SupportedLocale {
  return lang === 'en' || lang === 'es' || lang === 'de';
}

export function LanguagePicker({ auditService }: LanguagePickerProps) {
  const { t } = useTranslation();
  const setLanguage = useSettingsStore((s) => s.setLanguage);

  // Lazily construct the audit service so tests that pass one in don't pay
  // the localStorage hit, and React doesn't churn on re-renders.
  const audit = useMemo(
    () => auditService ?? new AuditService('default'),
    [auditService],
  );

  const current: SupportedLocale = isSupported(i18n.language)
    ? i18n.language
    : 'en';

  const handleChange = useCallback(
    async (next: SupportedLocale) => {
      if (next === current) return;
      const from = current;
      await i18n.changeLanguage(next);
      setLanguage(next);
      audit.append({
        type: 'language_changed',
        timestamp: new Date().toISOString(),
        payload: { from, to: next },
      });
    },
    [current, setLanguage, audit],
  );

  const controlId = 'setting-control-language';

  return (
    <div
      data-testid="setting-language"
      className="flex items-center justify-between py-3 border-b border-border/50 last:border-b-0"
    >
      <div className="flex-1 min-w-0 mr-4">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={controlId} className="text-sm font-medium cursor-pointer">
            {t('settings.language.label')}
          </Label>
          <InfoHelp
            content={t('settings.language.description')}
            label={`About ${t('settings.language.label')}`}
          />
        </div>
      </div>
      <div className="shrink-0">
        <select
          id={controlId}
          data-testid="language-picker-select"
          value={current}
          onChange={(e) => {
            const next = e.target.value;
            if (isSupported(next)) {
              void handleChange(next);
            }
          }}
          className="h-8 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        >
          {LOCALE_OPTIONS.map((lang) => {
            const label =
              lang === 'en'
                ? t('settings.language.options.en')
                : lang === 'es'
                  ? t('settings.language.options.es')
                  : t('settings.language.options.de');
            return (
              <option key={lang} value={lang}>
                {label}
              </option>
            );
          })}
        </select>
      </div>
    </div>
  );
}

export default LanguagePicker;
