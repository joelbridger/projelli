/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { ClipboardList, Plus } from 'lucide-react';
import { Button } from '@/ui/kp';
import { Screen, mutedStyle, panelStyle } from '@/features/crm-home/shared/ui';

export function IntakeLinks() {
  return (
    <Screen title="Intake links" description="Scoped forms that create reviewable submissions" Icon={ClipboardList} action={<Button data-testid="crm-intake-new" iconLeft={Plus}>New intake link</Button>}>
      <section style={panelStyle}>
        <strong>New client information</strong>
        <p style={mutedStyle}>Choose fields and confirmation copy, preview on phone or desktop, then copy/share the link. A submission never writes directly into a household.</p>
        <Button variant="secondary">Preview form</Button>{' '}<Button variant="secondary">Copy link</Button>
      </section>
      <section style={panelStyle}>
        <strong>Submission review</strong>
        <p>One response needs a deliberate match/create decision.</p>
        <Button>Match this response</Button>
      </section>
    </Screen>
  );
}
