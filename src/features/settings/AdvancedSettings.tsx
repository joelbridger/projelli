/**
 * AdvancedSettings — placeholder page.
 *
 * Streams populate this with power-user settings and per-feature kill switches
 * as features land. For now it's a shell so the nav item resolves.
 */

import { useTranslation } from 'react-i18next';
import { InfoHelp } from '@/ui/InfoHelp';

export function AdvancedSettings() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-medium">{t('settings.advanced.title')}</h3>
        <InfoHelp
          content={t('settings.advanced.description')}
          label={`About ${t('settings.advanced.title')}`}
        />
      </div>
    </div>
  );
}
