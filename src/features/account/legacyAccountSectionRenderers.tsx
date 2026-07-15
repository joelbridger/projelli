/* eslint-disable lantern-i18n/no-hardcoded-string */
import { Fragment, useState } from 'react';
import { Building2 } from 'lucide-react';
import { Button } from '@/ui/kp';
import { useFirm } from '@/platform/hooks/useFirm';
import { FirmAdminConsole, FirmSignIn, UseWithFirmFlow } from '@/features/firm';
import { BRAND } from '@/config/brand';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/ui/accordion';
import { getConnectionCardDescriptors } from './connectionCardRegistry';

export function FirmSection() {
  const { isSignedIn, hasActiveSeat } = useFirm();
  const isSolo = !isSignedIn || !hasActiveSeat;
  const [showBridge, setShowBridge] = useState(false);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--kp-space-lg)',
      }}
    >
      {isSolo && !showBridge && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--kp-space-md)',
            padding: 'var(--kp-space-md)',
            borderRadius: 'var(--kp-radius-md)',
            border: '1px solid var(--color-primary)',
            background:
              'color-mix(in srgb, var(--color-primary) 6%, transparent)',
          }}
        >
          <Building2
            size={20}
            style={{
              color: 'var(--color-primary)',
              flexShrink: 0,
              marginTop: 2,
            }}
            aria-hidden
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 600, fontSize: 'var(--kp-font-sm)' }}>
              Use {BRAND.name} with your firm
            </p>
            <p
              style={{
                fontSize: 'var(--kp-font-xs)',
                color: 'var(--color-muted-foreground)',
                margin: '4px 0 8px',
              }}
            >
              Start a firm or join one, then bring your clients over. You choose
              for each client whether it stays private or is shared with
              colleagues.
            </p>
            <Button
              size="sm"
              data-testid="use-with-firm-action"
              onClick={() => {
                setShowBridge(true);
              }}
            >
              Use this with my firm
            </Button>
          </div>
        </div>
      )}
      {showBridge ? (
        <UseWithFirmFlow
          onClose={() => {
            setShowBridge(false);
          }}
        />
      ) : (
        <>
          <FirmSignIn />
          <FirmAdminConsole />
        </>
      )}
    </div>
  );
}

export function ConnectionsSection() {
  const cards = getConnectionCardDescriptors('connections');
  const developerTools = getConnectionCardDescriptors('developer-tools');
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--kp-space-lg)',
      }}
    >
      {cards.map((card) => (
        <Fragment key={card.id}>{card.render()}</Fragment>
      ))}
      {developerTools.length > 0 && (
        <Accordion data-testid="connections-developer-tools">
          <AccordionItem value="developer-tools">
            <AccordionTrigger data-testid="connections-developer-tools-trigger">
              Developer tools
            </AccordionTrigger>
            <AccordionContent>
              {developerTools.map((card) => (
                <Fragment key={card.id}>{card.render()}</Fragment>
              ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}
