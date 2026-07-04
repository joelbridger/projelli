/**
 * MessageBubble — all-matters scope tooltip must use the PLURAL entity noun.
 *
 * Coordinator P3 finding: the allMatters-scope tooltip passed the SINGULAR
 * entityLabel (e.g. "cliente"/"Kunde") into the ask.message-scope.all-title
 * key, whose es/de translations use plural-agreeing words ("todos los" /
 * "alle") — producing ungrammatical output ("todos los cliente"). The fix
 * passes the plural form (entityLabel.other) for the allMatters branch only;
 * the single-active-matter branch correctly keeps the singular form.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { EntityLabel } from '@/platform/hooks/useEntityLabel';
import type { ChatMessage, TurnScope } from '@/platform/types/ai';
import { MessageBubble } from '@/features/ask/chat/MessageBubble';

const entityLabel: EntityLabel = {
  one: 'cliente',
  other: 'clientes',
  One: 'Cliente',
  Other: 'Clientes',
  household: 'cliente',
  households: 'clientes',
  Household: 'Cliente',
  Households: 'Clientes',
  confidentialityColumn: 'Confidencial',
  confidentialityBadge: 'Confidencial',
};

function makeMessage(scope: TurnScope): ChatMessage {
  return {
    role: 'assistant',
    content: 'answer',
    timestamp: '2026-07-04T00:00:00.000Z',
    scope,
  };
}

describe('MessageBubble scope tooltip grammar', () => {
  it('passes the PLURAL entity to the all-matters tooltip key', () => {
    const t = vi.fn((key: string, opts?: Record<string, unknown>) => `${key}:${JSON.stringify(opts)}`);
    render(
      <MessageBubble
        msg={makeMessage({ kind: 'allMatters' })}
        idx={0}
        isLastMessage={false}
        t={t as never}
        entityLabel={entityLabel}
        handleCitationClick={() => {}}
        handleMissingSource={() => {}}
        onRetryLastError={() => {}}
      />,
    );

    expect(t).toHaveBeenCalledWith('ask.message-scope.all-title', { entity: 'clientes' });
    expect(t).not.toHaveBeenCalledWith('ask.message-scope.all-title', { entity: 'cliente' });
  });

  it('still passes the SINGULAR entity for a single active-matter scope', () => {
    const t = vi.fn((key: string, opts?: Record<string, unknown>) => `${key}:${JSON.stringify(opts)}`);
    render(
      <MessageBubble
        msg={makeMessage({ kind: 'matter', matterId: 'm-1', matterName: 'Acme' })}
        idx={0}
        isLastMessage={false}
        t={t as never}
        entityLabel={entityLabel}
        handleCitationClick={() => {}}
        handleMissingSource={() => {}}
        onRetryLastError={() => {}}
      />,
    );

    expect(t).toHaveBeenCalledWith('ask.message-scope.matter-title', { entity: 'cliente' });
  });
});
