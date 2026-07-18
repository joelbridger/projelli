import { useCallback, useEffect, useReducer, useRef } from 'react';
import { PlugZap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, Callout, EmptyState } from '@/ui/kp';
import {
  getConnectionCardDescriptors,
  type ConnectionCardDescriptor,
} from '@/features/account';

type ConnectionCardReader = (
  placement: 'connections'
) => readonly ConnectionCardDescriptor[];

interface ActiveIntegrationsSectionProps {
  /** Focused test seam; production always uses Account's public reader. */
  readConnectionCards?: ConnectionCardReader;
}

interface ConnectionCardReadResult {
  cards: readonly ConnectionCardDescriptor[];
  unavailable: boolean;
  omittedCount: number;
}

function readRenderableCards(
  readConnectionCards: ConnectionCardReader
): ConnectionCardReadResult {
  try {
    const descriptors = readConnectionCards('connections');
    const cards = descriptors.filter(
      (descriptor) =>
        typeof descriptor.renderStatus === 'function' &&
        typeof descriptor.renderSafeDisconnect === 'function'
    );
    return {
      cards,
      unavailable: false,
      omittedCount: descriptors.length - cards.length,
    };
  } catch {
    return { cards: [], unavailable: true, omittedCount: 0 };
  }
}

interface ConnectorOwnedCardProps {
  card: ConnectionCardDescriptor;
  onConnectorInteraction: () => void;
}

function ConnectorOwnedCard({
  card,
  onConnectorInteraction,
}: ConnectorOwnedCardProps) {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || !cardRef.current) return;

    const observer = new MutationObserver(() => {
      onConnectorInteraction();
    });
    observer.observe(cardRef.current, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
    };
  }, [onConnectorInteraction]);

  return (
    <Card
      ref={cardRef}
      data-testid={`active-integration-card-${card.id}`}
      style={{ display: 'grid', gap: 'var(--kp-space-md)' }}
    >
      <header style={{ display: 'grid', gap: 4 }}>
        <h3 style={{ margin: 0, fontSize: 'var(--kp-font-md)' }}>
          {t(card.labelKey)}
        </h3>
        <p
          style={{
            margin: 0,
            color: 'var(--kp-text-faint)',
            fontSize: 'var(--kp-font-sm)',
          }}
        >
          {t('active-integrations.connector-owned-note')}
        </p>
      </header>

      <section
        aria-label={t('active-integrations.status-and-access')}
        data-testid={`active-integration-status-${card.id}`}
      >
        {card.renderStatus()}
      </section>

      <section
        aria-label={t('active-integrations.disconnect-control')}
        data-testid={`active-integration-disconnect-${card.id}`}
        onClickCapture={onConnectorInteraction}
      >
        {card.renderSafeDisconnect()}
      </section>
    </Card>
  );
}

/**
 * Account's active-integration view. Connector cards retain ownership of all
 * status, capability, confirmation, and disconnect behavior rendered here.
 */
export function ActiveIntegrationsSection({
  readConnectionCards = getConnectionCardDescriptors,
}: ActiveIntegrationsSectionProps) {
  const { t } = useTranslation();
  const [, refreshPublicRead] = useReducer((version: number) => version + 1, 0);
  const requestFreshPublicRead = useCallback(() => {
    refreshPublicRead();
  }, []);
  const { cards, unavailable, omittedCount } =
    readRenderableCards(readConnectionCards);

  return (
    <section
      data-testid="active-integrations-section"
      style={{ display: 'grid', gap: 'var(--kp-space-lg)', maxWidth: 880 }}
    >
      <header style={{ display: 'grid', gap: 6 }}>
        <h2 style={{ margin: 0 }}>{t('active-integrations.title')}</h2>
        <p
          style={{
            margin: 0,
            color: 'var(--kp-text-faint)',
            fontSize: 'var(--kp-font-sm)',
          }}
        >
          {t('active-integrations.description')}
        </p>
      </header>

      {omittedCount > 0 ? (
        <Callout variant="warning">
          <span data-testid="active-integrations-omitted">
            {t('active-integrations.omitted-card', { count: omittedCount })}
          </span>
        </Callout>
      ) : null}

      {cards.length > 0 ? (
        <div
          data-testid="active-integrations-list"
          style={{ display: 'grid', gap: 'var(--kp-space-md)' }}
        >
          {cards.map((card) => (
            <ConnectorOwnedCard
              key={card.id}
              card={card}
              onConnectorInteraction={requestFreshPublicRead}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          data-testid="active-integrations-empty"
          icon={PlugZap}
          title={t(
            unavailable
              ? 'active-integrations.unavailable-title'
              : 'active-integrations.empty-title'
          )}
          body={t(
            unavailable
              ? 'active-integrations.unavailable-description'
              : 'active-integrations.empty-description'
          )}
        />
      )}
    </section>
  );
}
