// StillImportingBanner (QA-90) — while connectors are still bringing in
// email, files, or CRM data, a half-empty Ask answer should read as "still
// importing," not "broken." Reuses the same setup-progress signal the setup
// screen shows (useSetupProgress, QA-89) rather than tracking sync state a
// second way. Auto-hides the moment every content source finishes.

import { Download } from 'lucide-react';
import { Callout } from '@/ui/kp';
import { useSetupProgress } from '@/platform/hooks/useSetupProgress';
import { isImportingContent } from '@/platform/utils/setup-progress-commands';

export function StillImportingBanner() {
  const progress = useSetupProgress();
  if (!progress || !isImportingContent(progress)) return null;

  return (
    <div data-testid="ask-still-importing-banner" role="status" aria-live="polite">
      <Callout variant="info" icon={Download}>
        {'Still bringing in your files and email — answers may be incomplete.'}
      </Callout>
    </div>
  );
}
