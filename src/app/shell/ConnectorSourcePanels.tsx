// ConnectorSourcePanels — bundles every connector citation viewer (each one
// listens for its own `lantern:open-<connector>` window event and renders a
// lightweight read-only panel) behind a single lazy import. None of these
// render anything until their event fires, so grouping them keeps App.tsx's
// initial import graph free of nine small-but-unused modules on every
// startup, at the cost of one extra chunk fetched the first time any
// citation of this kind is opened.

import { useEffect } from 'react';
import { CrmSourcePanel } from '@/features/crm/CrmSourcePanel';
import { OneDriveSourcePanel } from '@/features/onedrive/OneDriveSourcePanel';
import { DocusignSourcePanel } from '@/features/docusign/DocusignSourcePanel';
import { MeetingSourcePanel } from '@/features/calendly/MeetingSourcePanel';
import { BoxSourcePanel } from '@/features/box/BoxSourcePanel';
import { SharefileSourcePanel } from '@/features/sharefile/SharefileSourcePanel';
import { JotformSourcePanel } from '@/features/jotform/JotformSourcePanel';
import { ZocksSourcePanel } from '@/features/zocks/ZocksSourcePanel';
import { AddeparSourcePanel } from '@/features/addepar/AddeparSourcePanel';
import { handOffToConnectorPanels } from './connectorEventBridge';

export default function ConnectorSourcePanels() {
  // React flushes child effects before parent effects, so by the time this
  // runs, every panel below has already installed its own window listener —
  // safe to replay anything connectorEventBridge buffered while this chunk
  // was loading and hand off future events straight to the panels.
  useEffect(() => {
    handOffToConnectorPanels();
  }, []);

  return (
    <>
      {/* Wealthbox CRM citation viewer — listens for lantern:open-crm events
          dispatched when a `crm:` source link is clicked in a Client Map. */}
      <CrmSourcePanel />
      <OneDriveSourcePanel />
      <DocusignSourcePanel />
      <MeetingSourcePanel />
      {/* Bonus connector citation viewers — each listens for its
          lantern:open-<connector> event dispatched from a Client Map source link. */}
      <BoxSourcePanel />
      <SharefileSourcePanel />
      <JotformSourcePanel />
      <ZocksSourcePanel />
      <AddeparSourcePanel />
    </>
  );
}
