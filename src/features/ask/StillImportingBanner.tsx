// StillImportingBanner (QA-90) — while connectors are still bringing in
// email, files, or CRM data, a half-empty Ask answer should read as "still
// importing," not "broken." Auto-hides the moment every content source
// finishes. `importing` comes from useAsk (which reads useStillImporting
// once for the whole surface — handleAsk's retrieval-evidence gate needs the
// same signal, so this component takes it as a prop rather than each
// consumer mounting its own listener).

import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Callout } from '@/ui/kp';

export function StillImportingBanner({ importing }: { importing: boolean }) {
  const { t } = useTranslation();
  if (!importing) return null;

  return (
    <div data-testid="ask-still-importing-banner" role="status" aria-live="polite">
      <Callout variant="info" icon={Download}>
        {t('ask.turn.importing-banner')}
      </Callout>
    </div>
  );
}
