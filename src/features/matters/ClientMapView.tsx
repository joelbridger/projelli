// src/features/matters/ClientMapView.tsx
import type { CSSProperties } from 'react';
import { Card, Eyebrow, Chip, Button } from '@/ui/kp';
import { CORE_SECTION_ORDER, CORE_SECTION_TITLE } from '@/platform/clientMap/types';
import type { ClientMap, ClientMapItem, SourceRef, CompletenessLevel, GapQuestion } from '@/platform/clientMap/types';
import { flagForClient } from '@/platform/clientMap/guidedInterview';

const LEVEL_LABEL: Record<CompletenessLevel, string> = {
  thin: 'Thin',
  'getting-there': 'Getting there',
  solid: 'Solid',
};

const itemRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  columnGap: 8,
  rowGap: 6,
  margin: '6px 0',
  lineHeight: 1.5,
};

const itemTextStyle: CSSProperties = {
  color: 'var(--kp-navy)',
};

const sourceChipStyle: CSSProperties = {
  height: 22,
  minHeight: 22,
  padding: '0 8px',
  borderColor: 'var(--color-border)',
  background: 'var(--color-muted)',
  color: 'var(--color-muted-foreground)',
  fontSize: 'var(--kp-font-xs)',
  fontWeight: 'var(--kp-weight-semibold)',
};

const editButtonStyle: CSSProperties = {
  height: 22,
  minHeight: 22,
  padding: '0 8px',
  color: 'var(--kp-navy)',
  fontSize: 'var(--kp-font-xs)',
};

const assumptionStyle: CSSProperties = {
  color: 'var(--color-muted-foreground)',
  fontSize: 'var(--kp-font-xs)',
};

function SourceChip({
  source,
  onOpenSource,
}: {
  source: SourceRef;
  onOpenSource: (r: SourceRef) => void;
}) {
  const label = `${source.kind === 'email' ? 'email' : 'source'}${source.locator != null ? ` ${source.locator}` : ''}`;
  return (
    <Chip
      data-testid="clientmap-source-link"
      size="sm"
      style={sourceChipStyle}
      aria-label={`Open ${label}`}
      onClick={() => {
        onOpenSource(source);
      }}
    >
      {label}
    </Chip>
  );
}

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
    <li data-testid="clientmap-item" style={itemRowStyle}>
      <span style={itemTextStyle}>{item.text}</span>
      {item.isAssumption && (
        <span data-testid="clientmap-item-assumption" style={assumptionStyle}>
          assuming
        </span>
      )}
      {item.sources.map((s, i) => (
        <SourceChip
          key={i}
          source={s}
          onOpenSource={onOpenSource}
        />
      ))}
      {onEdit != null && (
        <Button
          type="button"
          data-testid="clientmap-item-edit"
          variant="ghost"
          size="sm"
          style={editButtonStyle}
          onClick={onEdit}
        >
          Edit
        </Button>
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
        {/* eslint-disable lantern-i18n/no-hardcoded-string */}
        <Eyebrow>What I'm missing</Eyebrow>
        <Chip data-testid="clientmap-completeness-level">
          {LEVEL_LABEL[c.level]}
        </Chip>
        <Eyebrow>What I know</Eyebrow>
        {/* eslint-enable lantern-i18n/no-hardcoded-string */}
        <ul>
          {c.know.map((it) => (
            <Item key={it.id} item={it} onOpenSource={onOpenSource} />
          ))}
        </ul>
        {/* eslint-disable lantern-i18n/no-hardcoded-string */}
        <Eyebrow>What I'm assuming</Eyebrow>
        {/* eslint-enable lantern-i18n/no-hardcoded-string */}
        <ul>
          {c.assuming.map((it) => (
            <Item key={it.id} item={it} onOpenSource={onOpenSource} />
          ))}
        </ul>
        {/* eslint-disable-next-line lantern-i18n/no-hardcoded-string */}
        <Eyebrow>What to ask</Eyebrow>
        <ul>
          {c.ask.map((q, i) => (
            <li key={i} data-testid="clientmap-ask" style={itemRowStyle}>
              <span style={itemTextStyle}>{q.text}</span>
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
