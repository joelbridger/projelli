import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { PlugZap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState } from '@/ui/kp';
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

type ConnectionCardReadResult =
  | { status: 'checking'; cards: readonly ConnectionCardDescriptor[] }
  | { status: 'ready'; cards: readonly ConnectionCardDescriptor[] }
  | { status: 'unavailable'; cards: readonly ConnectionCardDescriptor[] };

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
          {card.displayName}
        </h3>
        <p
          style={{
            margin: 0,
            color: 'var(--kp-text-faint)',
            fontSize: 'var(--kp-font-sm)',
          }}
        >
          {t('active-integrations.connected')}
        </p>
      </header>

      <section
        aria-label={t('active-integrations.manage', {
          provider: card.displayName,
        })}
        data-testid={`active-integration-form-${card.id}`}
        onClick={onConnectorInteraction}
      >
        {card.render()}
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
  const [refreshVersion, refreshPublicRead] = useReducer(
    (version: number) => version + 1,
    0
  );
  const requestFreshPublicRead = useCallback(() => {
    refreshPublicRead();
  }, []);
  const [result, setResult] = useState<ConnectionCardReadResult>({
    status: 'checking',
    cards: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function checkConnections(): Promise<void> {
      // Keep this state update asynchronous so opening the section never
      // creates a synchronous effect-render loop.
      await Promise.resolve();
      const descriptors = readConnectionCards('connections');
      const connectionStates = await Promise.all(
        descriptors.map(async (descriptor) => {
          if (typeof descriptor.isConnected !== 'function') return false;
          try {
            return await descriptor.isConnected();
          } catch {
            return false;
          }
        })
      );
      if (cancelled) return;
      setResult({
        status: 'ready',
        cards: descriptors.filter((_, index) => connectionStates[index]),
      });
    }

    void checkConnections().catch(() => {
      if (!cancelled) {
        setResult({ status: 'unavailable', cards: [] });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [readConnectionCards, refreshVersion]);

  const { cards } = result;

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

      {result.status === 'checking' ? (
        <p role="status" data-testid="active-integrations-checking">
          {t('active-integrations.checking')}
        </p>
      ) : cards.length > 0 ? (
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
            result.status === 'unavailable'
              ? 'active-integrations.unavailable-title'
              : 'active-integrations.empty-title'
          )}
          body={t(
            result.status === 'unavailable'
              ? 'active-integrations.unavailable-description'
              : 'active-integrations.empty-description'
          )}
        />
      )}
    </section>
  );
}
