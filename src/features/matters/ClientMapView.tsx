// src/features/matters/ClientMapView.tsx
import { Card, Eyebrow, Chip, Button } from '@/ui/kp';
import { CORE_SECTION_ORDER, CORE_SECTION_TITLE } from '@/platform/clientMap/types';
import type { ClientMap, ClientMapItem, SourceRef, CompletenessLevel, GapQuestion } from '@/platform/clientMap/types';
import { flagForClient } from '@/platform/clientMap/guidedInterview';

const LEVEL_LABEL: Record<CompletenessLevel, string> = {
  thin: 'Thin',
  'getting-there': 'Getting there',
  solid: 'Solid',
};

function Item({
  item,
  onOpenSource,
  onEdit,
}: {
  item: ClientMapItem;
  onOpenSource: (r: SourceRef) => void;
  onEdit?: () => void;
}) {
  return (
    <li data-testid="clientmap-item">
      <span>{item.text}</span>
      {item.isAssumption && (
        <span data-testid="clientmap-item-assumption"> (assuming)</span>
      )}
      {item.sources.map((s, i) => (
        <button
          key={i}
          type="button"
          data-testid="clientmap-source-link"
          onClick={() => {
            onOpenSource(s);
          }}
        >
          {s.kind === 'email' ? 'email' : 'source'}
          {s.locator != null ? ` ${s.locator}` : ''}
        </button>
      ))}
      {onEdit != null && (
        <button type="button" data-testid="clientmap-item-edit" onClick={onEdit}>
          edit
        </button>
      )}
    </li>
  );
}

const LABEL_I_KNOW = 'I know this';
const LABEL_ASK_CLIENT = 'Ask the client';

export function ClientMapView({
  map,
  onOpenSource,
  onEditItem,
  onAnswerQuestion,
  onFlagForClient,
}: {
  map: ClientMap;
  onOpenSource: (r: SourceRef) => void;
  onEditItem: (sectionKey: string, itemId: string) => void;
  onAnswerQuestion?: (question: GapQuestion) => void;
  onFlagForClient?: (question: GapQuestion) => void;
}) {
  const c = map.completeness;
  return (
    <div data-testid="clientmap-view">
      {CORE_SECTION_ORDER.map((key) => {
        const sec = map.sections.find((s) => s.key === key);
        return (
          <Card key={key} variant="raised" data-testid={`clientmap-section-${key}`}>
            <Eyebrow>{CORE_SECTION_TITLE[key]}</Eyebrow>
            <ul>
              {(sec?.items ?? []).map((it) => (
                <Item
                  key={it.id}
                  item={it}
                  onOpenSource={onOpenSource}
                  onEdit={() => {
                    onEditItem(key, it.id);
                  }}
                />
              ))}
            </ul>
          </Card>
        );
      })}
      {map.sections
        .filter((s) => s.kind === 'custom')
        .map((sec) => (
          <Card
            key={sec.id}
            variant="raised"
            data-testid={`clientmap-section-custom-${sec.id}`}
          >
            <Eyebrow>{sec.title}</Eyebrow>
            <ul>
              {sec.items.map((it) => (
                <Item
                  key={it.id}
                  item={it}
                  onOpenSource={onOpenSource}
                  onEdit={() => {
                    onEditItem(sec.key, it.id);
                  }}
                />
              ))}
            </ul>
          </Card>
        ))}
      <Card variant="raised" data-testid="clientmap-completeness">
        {/* eslint-disable keepance-i18n/no-hardcoded-string */}
        <Eyebrow>What I'm missing</Eyebrow>
        <Chip data-testid="clientmap-completeness-level">
          {LEVEL_LABEL[c.level]}
        </Chip>
        <Eyebrow>What I know</Eyebrow>
        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
        <ul>
          {c.know.map((it) => (
            <li key={it.id} data-testid="clientmap-item">
              <span>{it.text}</span>
              {it.sources.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  data-testid="clientmap-source-link"
                  onClick={() => {
                    onOpenSource(s);
                  }}
                >
                  {s.kind === 'email' ? 'email' : 'source'}
                  {s.locator != null ? ` ${s.locator}` : ''}
                </button>
              ))}
            </li>
          ))}
        </ul>
        {/* eslint-disable keepance-i18n/no-hardcoded-string */}
        <Eyebrow>What I'm assuming</Eyebrow>
        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
        <ul>
          {c.assuming.map((it) => (
            <li key={it.id} data-testid="clientmap-item">
              <span>{it.text}</span>
              {it.sources.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  data-testid="clientmap-source-link"
                  onClick={() => {
                    onOpenSource(s);
                  }}
                >
                  {s.kind === 'email' ? 'email' : 'source'}
                  {s.locator != null ? ` ${s.locator}` : ''}
                </button>
              ))}
            </li>
          ))}
        </ul>
        {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
        <Eyebrow>What to ask</Eyebrow>
        <ul>
          {c.ask.map((q, i) => (
            <li key={i} data-testid="clientmap-ask">
              <span>{q.text}</span>
              <Button
                data-testid="clientmap-ask-know"
                size="sm"
                variant="secondary"
                onClick={() => {
                  onAnswerQuestion?.(q);
                }}
              >
                {LABEL_I_KNOW}
              </Button>
              <Button
                data-testid="clientmap-ask-flag"
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (onFlagForClient) {
                    onFlagForClient(q);
                  } else {
                    flagForClient(map.matterId, q.text);
                  }
                }}
              >
                {LABEL_ASK_CLIENT}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
