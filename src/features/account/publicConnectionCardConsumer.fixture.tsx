import { Fragment } from 'react';
import {
  getConnectionCardDescriptors,
  type ConnectionCardDescriptor,
  type ConnectionCardPlacement,
} from '@/features/account';

interface ActiveIntegrationsConsumerFixtureProps {
  placement: ConnectionCardPlacement;
  descriptors?: readonly ConnectionCardDescriptor[];
}

/** Compile/runtime fixture for a feature consuming only Account's public doorway. */
export function ActiveIntegrationsConsumerFixture({
  placement,
  descriptors,
}: ActiveIntegrationsConsumerFixtureProps) {
  const cards = getConnectionCardDescriptors(placement, descriptors);

  return (
    <>
      {cards.map((card) => (
        <Fragment key={card.id}>
          {card.renderStatus()}
          {card.renderSafeDisconnect()}
        </Fragment>
      ))}
    </>
  );
}
