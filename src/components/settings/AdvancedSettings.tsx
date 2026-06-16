/**
 * AdvancedSettings — placeholder page.
 *
 * Streams populate this with power-user settings and per-feature kill switches
 * as features land. For now it's a shell so the nav item resolves.
 */

import { useTranslation } from 'react-i18next';

export function AdvancedSettings() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {t('settings.advanced.description')}
      </p>
    </div>
  );
}
