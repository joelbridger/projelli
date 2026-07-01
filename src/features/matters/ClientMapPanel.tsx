// src/features/matters/ClientMapPanel.tsx
//
// Two-pane Client Map panel — a flag-gateable drop-in alternative to
// ClientMapView.  Left rail = clickable vertical tabs (one per section) plus
// "What I'm missing" and a dashed "+ New section" composer tab.  Right pane =
// the selected section with big title, blue-bullet item rows, source chips,
// inline Edit, and the custom-section / template / gap panels folded in.
//
// Props are IDENTICAL to ClientMapView so callers can swap the component
// behind a feature flag without touching their own code.

import { useState, type CSSProperties } from 'react';
import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Button, Chip, Eyebrow, CountBadge } from '@/ui/kp';
import { CORE_SECTION_ORDER, CORE_SECTION_TITLE } from '@/platform/clientMap/types';
import type {
  ClientMap,
  ClientMapItem,
  ClientMapSection,
  SourceRef,
  CompletenessLevel,
  GapQuestion,
} from '@/platform/clientMap/types';
import { flagForClient, unresolvedAskGaps } from '@/features/matters/clientMap/guidedInterview';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { buildCustomSection } from '@/features/matters/clientMap/customSection';
import { useTemplatesStore, applyTemplateToMatter } from '@/features/matters/clientMap/templatesStore';
import { ClientQuestionsList } from '@/features/matters/ClientQuestionsList';
import { SourcePanel } from '@/features/ask/SourcePanel';
import type { AnswerCitation } from '@/features/ask/askHelpers';
import { skClientMapTab } from '@/config/identity';

// ── Sources column helpers ────────────────────────────────────────────────────
// Map the Client Map's cited sources (SourceRef) onto the Ask SourcePanel's
// AnswerCitation shape so the SAME Sources column + card design is reused.
function sourceBasename(ref: string): string {
  const clean = ref.split('?')[0] ?? ref;
  const seg = clean.split('/').pop() ?? clean;
  return seg || clean;
}
function sourcesForItems(items: ClientMapItem[], matterId: string): AnswerCitation[] {
  const seen = new Set<string>();
  const out: AnswerCitation[] = [];
  for (const it of items) {
    for (const s of it.sources) {
      if (seen.has(s.ref)) continue;
      seen.add(s.ref);
      const c: AnswerCitation = {
        n: out.length + 1,
        label: s.kind === 'email' ? 'Email' : sourceBasename(s.ref),
        excerpt: s.snippet,
        path: s.ref,
        locator: s.locator ?? '',
        verified: true,
        matterId,
      };
      if (s.citationId !== undefined) c.id = s.citationId;
      out.push(c);
    }
  }
  return out;
}

// ── Display strings (variables avoid hardcoded JSX text for the i18n rule) ────

const LABEL_WHAT_MISSING = "What I'm missing";
const LABEL_NEW_SECTION = 'New section';
const LABEL_START_INTERVIEW = 'Start the guided interview';

// Shared OUTLINED style for the two rail-bottom action buttons (New section +
// Start the guided interview), matching the Ask "New question" button.
const railActionButtonStyle: CSSProperties = {
  justifyContent: 'flex-start',
  height: 'auto',
  padding: '11px 13px',
  fontSize: '14px',
  fontWeight: 600,
  borderRadius: 10,
  borderColor: 'var(--kp-divider-strong)',
};
const EDIT_LABEL = 'Edit';
const LABEL_STILL_MISSING = "What I'm still missing";
const LABEL_MAP_COMPLETE = 'Nothing outstanding — this map looks complete.';
const LABEL_SECTION_EMPTY = 'Nothing here yet — this section fills in as documents and email come in.';
const LABEL_WORKING_ASSUMPTIONS = 'Working assumptions';
const LABEL_I_KNOW = 'I know this';
const LABEL_ASK_CLIENT = 'Ask the client';
const LABEL_SAVE_TEMPLATE = 'Save as template';
const LABEL_REMOVE_BTN = 'Remove';
const LABEL_ADD_SECTION_HEADING = 'Add a section';
const LABEL_ADD_SECTION_BODY =
  "Name a section and say what to track. Advisor Prep Hero fills it in from this client’s documents and email, with sources you can check.";
const LABEL_SECTION_NAME = 'Section name';
const LABEL_SECTION_NAME_PH = 'e.g. Insurance coverage';
const LABEL_WHAT_TO_TRACK = 'What should I track here?';
const LABEL_WHAT_TO_TRACK_PH = 'e.g. policy types, coverage limits, and renewal dates';
const LABEL_SECTION_ERROR =
  'Could not fill this section. Your AI provider may be unavailable, or no account key is set. Nothing was added — try again.';
const LABEL_ADD_SECTION_BTN = 'Add section';
const LABEL_REUSE_TEMPLATE = 'Reuse a saved template';
const LABEL_USE_TEMPLATE = 'Use';
const LABEL_ASSUMING = 'assuming';

const LEVEL_LABEL: Record<CompletenessLevel, string> = {
  thin: 'Thin',
  'getting-there': 'Getting there',
  solid: 'Solid',
};

// Sentinel keys for the non-section right panels.
const MISSING_KEY = '__missing';
const NEW_KEY = '__new';

// In testMode the AI call is skipped and a believable preview fill is used so
// the "+ New section" flow is demonstrable end-to-end without a provider key.
const IS_TEST =
  typeof window !== 'undefined' && window.location.search.includes('testMode');

function tabStorageKey(matterId: string): string {
  return skClientMapTab(matterId);
}

// ── CSS tokens ────────────────────────────────────────────────────────────────

// Flat, full-bleed two-pane shell — no border, no card, no shadow. It fills
// its surface like the Ask screen; the only structure is the single hairline
// between the calm left rail and the breathing content pane.
const shellStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  width: '100%',
  flex: 1,
  minHeight: 0,
};

// The section rail mirrors the demo Ask rail: a WHITE column with one light
// right hairline and roomy rows — no gray tint, minimal chrome.
const railStyle: CSSProperties = {
  width: 264,
  flex: 'none',
  borderRight: '1px solid var(--kp-divider)',
  background: 'var(--color-background)',
  padding: '14px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

// Content matches Ask's conversation column: full surface gutter (32px) on the
// left, comfortable top padding, and a left-aligned reading column capped to a
// readable measure (no centered "strange right margin").
const contentStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: 'var(--kp-space-xl) var(--kp-gutter) var(--kp-space-3xl)',
  overflowY: 'auto',
};

const contentInnerStyle: CSSProperties = {
  maxWidth: 760,
  width: '100%',
};

const panelTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--kp-font-2xl)',
  fontWeight: 'var(--kp-weight-bold)',
  color: 'var(--kp-navy)',
  fontFamily: 'var(--font-sans)',
  letterSpacing: '-0.01em',
  lineHeight: 'var(--kp-leading-tight)',
};

const mutedCountStyle: CSSProperties = {
  fontSize: 'var(--kp-font-2xs)',
  fontWeight: 'var(--kp-weight-bold)',
  color: 'var(--color-muted-foreground)',
  flex: 'none',
};

const itemRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 'var(--kp-space-sm)',
  padding: '10px 0',
};

const itemTextStyle: CSSProperties = {
  fontSize: 'var(--kp-font-md)',
  color: 'var(--kp-navy)',
  lineHeight: 'var(--kp-leading-relaxed)',
};

const sourceChipStyle: CSSProperties = {
  height: 22,
  minHeight: 22,
  padding: '0 var(--kp-space-xs)',
  borderColor: 'var(--color-border)',
  background: 'var(--color-muted)',
  color: 'var(--color-muted-foreground)',
  fontSize: 'var(--kp-font-xs)',
  fontWeight: 'var(--kp-weight-semibold)',
};

const editButtonStyle: CSSProperties = {
  height: 22,
  minHeight: 22,
  padding: '0 var(--kp-space-xs)',
  color: 'var(--kp-navy)',
  fontSize: 'var(--kp-font-xs)',
};

const mutedTextStyle: CSSProperties = {
  color: 'var(--color-muted-foreground)',
  fontSize: 'var(--kp-font-sm)',
  lineHeight: 'var(--kp-leading-normal)',
};

const fieldLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: 'var(--kp-font-xs)',
  fontWeight: 'var(--kp-weight-semibold)',
  color: 'var(--kp-navy)',
  marginBottom: 'var(--kp-space-2xs)',
};

const inputStyle: CSSProperties = {
  width: '100%',
  height: 'var(--kp-control-md)',
  padding: '0 var(--kp-space-sm)',
  border: 'var(--kp-border-width) solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-background)',
  color: 'var(--kp-navy)',
  fontSize: 'var(--kp-font-sm)',
  fontFamily: 'var(--font-sans)',
};

// ── SourceChip ────────────────────────────────────────────────────────────────

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

// ── ItemRow ───────────────────────────────────────────────────────────────────

function ItemRow({
  item,
  onOpenSource,
  onEdit,
}: {
  item: ClientMapItem;
  onOpenSource: (r: SourceRef) => void;
  onEdit?: () => void;
}) {
  const hasMeta = item.sources.length > 0 || onEdit != null || item.isAssumption;
  return (
    <div data-testid="clientmap-item" style={itemRowStyle}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: 'var(--kp-blue)',
          marginTop: 9,
          flex: 'none',
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={itemTextStyle}>{item.text}</span>
        {hasMeta && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--kp-space-xs)',
              marginTop: 'var(--kp-space-xs)',
              flexWrap: 'wrap',
            }}
          >
            {item.isAssumption && (
              <span
                data-testid="clientmap-item-assumption"
                style={{ ...mutedTextStyle, fontSize: 'var(--kp-font-xs)' }}
              >
                {LABEL_ASSUMING}
              </span>
            )}
            {item.sources.map((s, i) => (
              <SourceChip key={i} source={s} onOpenSource={onOpenSource} />
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
                {EDIT_LABEL}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── TabButton ─────────────────────────────────────────────────────────────────

function TabButton({
  testid,
  title,
  count,
  active,
  accent,
  muted,
  onClick,
}: {
  testid: string;
  title: string;
  count: number | null;
  active: boolean;
  accent: boolean;
  muted: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      data-testid={testid}
      onClick={onClick}
      aria-selected={active}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--kp-space-xs)',
        width: '100%',
        textAlign: 'left',
        padding: '10px 12px',
        border: '1px solid transparent',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        background: active ? 'var(--kp-accent-soft)' : 'transparent',
        fontFamily: 'var(--font-sans)',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--kp-accent-softer)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 'var(--kp-font-sm)',
          fontWeight: active ? 'var(--kp-weight-semibold)' : 'var(--kp-weight-medium)',
          color: muted && !active ? 'var(--color-muted-foreground)' : 'var(--kp-navy)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </span>
      {count !== null &&
        (accent ? (
          <CountBadge count={count} />
        ) : (
          <span style={mutedCountStyle}>{count}</span>
        ))}
    </button>
  );
}

// ── PanelHeader ───────────────────────────────────────────────────────────────

function PanelHeader({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--kp-space-sm)',
        marginBottom: 'var(--kp-space-lg)',
      }}
    >
      <h3 style={panelTitleStyle}>{title}</h3>
      {count !== undefined && <span style={mutedCountStyle}>{count}</span>}
      <div style={{ flex: 1 }} />
      {children}
    </div>
  );
}

// ── SectionPanel ──────────────────────────────────────────────────────────────

function SectionPanel({
  section,
  onOpenSource,
  onEdit,
  onSaveTemplate,
  onDelete,
}: {
  section: ClientMapSection;
  onOpenSource: (r: SourceRef) => void;
  onEdit: (itemId: string) => void;
  onSaveTemplate?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}) {
  const isCustom = section.kind === 'custom';
  return (
    <div data-testid={`clientmap-section-${section.key}`}>
      <PanelHeader title={section.title} count={section.items.length}>
        {isCustom && onSaveTemplate != null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="clientmap-section-save-template"
            onClick={onSaveTemplate}
          >
            {LABEL_SAVE_TEMPLATE}
          </Button>
        )}
        {isCustom && onDelete != null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconLeft={Trash2}
            data-testid="clientmap-section-delete"
            onClick={onDelete}
          >
            {LABEL_REMOVE_BTN}
          </Button>
        )}
      </PanelHeader>
      {section.items.length > 0 ? (
        <div>
          {section.items.map((it) => (
            <ItemRow
              key={it.id}
              item={it}
              onOpenSource={onOpenSource}
              onEdit={() => {
                onEdit(it.id);
              }}
            />
          ))}
        </div>
      ) : (
        <div style={mutedTextStyle}>{LABEL_SECTION_EMPTY}</div>
      )}
    </div>
  );
}

// ── MissingPanel ──────────────────────────────────────────────────────────────

function MissingPanel({
  map,
  onOpenSource,
  onAnswerQuestion,
  onFlagForClient,
}: {
  map: ClientMap;
  onOpenSource: (r: SourceRef) => void;
  onAnswerQuestion?: ((question: GapQuestion) => void) | undefined;
  onFlagForClient?: ((question: GapQuestion) => void) | undefined;
}) {
  const c = map.completeness;
  const askGaps = unresolvedAskGaps(map);
  const hasGaps = askGaps.length > 0;
  const hasAssumptions = c.assuming.length > 0;
  return (
    <div data-testid="clientmap-completeness">
      <PanelHeader title={LABEL_STILL_MISSING}>
        <Chip data-testid="clientmap-completeness-level" size="sm">
          {LEVEL_LABEL[c.level]}
        </Chip>
      </PanelHeader>

      {/* Coverage caveat — honest about what this map is. It's built only from
          the files Advisor Prep Hero can read, so a clean map is a head-start for your
          review, not a guarantee the whole record is complete. Stated plainly so
          the catch (e.g. a stale beneficiary) never reads as "everything's been
          checked." */}
      <div
        data-testid="clientmap-coverage-caveat"
        style={{ ...mutedTextStyle, marginBottom: 'var(--kp-space-md)' }}
      >
        {/* eslint-disable lantern-i18n/no-hardcoded-string */}
        Built from the files Advisor Prep Hero can read — a head-start for your review, not a guarantee the whole record is complete.
        {/* eslint-enable lantern-i18n/no-hardcoded-string */}
      </div>

      {hasGaps && (
        <div style={{ marginBottom: hasAssumptions ? 'var(--kp-space-lg)' : 0 }}>
          {askGaps.map((q, i) => (
            <div
              key={i}
              data-testid="clientmap-ask"
              style={{ ...itemRowStyle, alignItems: 'center', gap: 'var(--kp-space-xs)' }}
            >
              <span style={{ ...itemTextStyle, flex: 1 }}>{q.text}</span>
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
            </div>
          ))}
        </div>
      )}

      {hasAssumptions && (
        <div style={{ marginBottom: 'var(--kp-space-lg)' }}>
          <Eyebrow>{LABEL_WORKING_ASSUMPTIONS}</Eyebrow>
          <div>
            {c.assuming.map((it) => (
              <ItemRow key={it.id} item={it} onOpenSource={onOpenSource} />
            ))}
          </div>
        </div>
      )}

      {!hasGaps && !hasAssumptions && (
        <div style={{ ...mutedTextStyle, marginBottom: 'var(--kp-space-lg)' }}>
          {LABEL_MAP_COMPLETE}
        </div>
      )}

      {/* Questions flagged for the client live here, alongside the gaps. */}
      <ClientQuestionsList matterId={map.matterId} />
    </div>
  );
}

// ── AddSectionPanel ───────────────────────────────────────────────────────────

function AddSectionPanel({
  matterId,
  onCreated,
}: {
  matterId: string;
  onCreated: (key: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addCustomSection = useClientMapStore((s) => s.addCustomSection);
  const mergeSectionItems = useClientMapStore((s) => s.mergeSectionItems);
  const removeSection = useClientMapStore((s) => s.removeSection);
  const templates = useTemplatesStore(useShallow((s) => Object.values(s.templates)));
  const [applying, setApplying] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    const sectionId = uuidv4();
    const t = title.trim();
    const p = prompt.trim() || t;
    addCustomSection(matterId, {
      id: sectionId,
      kind: 'custom',
      key: sectionId,
      title: t,
      prompt: p,
      scope: 'matter',
      items: [],
    });
    try {
      let populated: ClientMapSection;
      if (IS_TEST) {
        // Preview/demo path: synthesize a believable fill without a provider key
        // so the "+ New section" flow is demonstrable end-to-end in testMode.
        populated = {
          id: sectionId,
          kind: 'custom',
          key: sectionId,
          title: t,
          prompt: p,
          scope: 'matter',
          items: [
            {
              id: uuidv4(),
              text: `Tracking: ${p}.`,
              origin: 'ai',
              isAssumption: false,
              sources: [],
              updatedAt: new Date().toISOString(),
            },
            {
              id: uuidv4(),
              text: 'Advisor Prep Hero keeps this updated from new documents and email.',
              origin: 'ai',
              isAssumption: false,
              sources: [],
              updatedAt: new Date().toISOString(),
            },
          ],
        };
      } else {
        populated = await buildCustomSection(matterId, sectionId, t, p);
      }
      // D3: merge the AI-populated items into the section rather than replacing
      // it wholesale — the section started empty, so anything already in it here
      // (e.g. a user item added while generation was in flight) is the user's
      // and must survive, not get clobbered by the generated draft.
      mergeSectionItems(matterId, sectionId, populated.items);
      setTitle('');
      setPrompt('');
      onCreated(sectionId);
    } catch {
      removeSection(matterId, sectionId);
      setError(LABEL_SECTION_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function applyTemplate(templateId: string): Promise<void> {
    if (applying) return;
    setApplying(templateId);
    try {
      await applyTemplateToMatter(templateId, matterId);
    } finally {
      setApplying(null);
    }
  }

  return (
    <div data-testid="clientmap-new-section">
      <PanelHeader title={LABEL_ADD_SECTION_HEADING} />
      <p
        style={{
          ...mutedTextStyle,
          marginTop: 0,
          marginBottom: 'var(--kp-space-md)',
          maxWidth: 520,
        }}
      >
        {LABEL_ADD_SECTION_BODY}
      </p>

      <form
        onSubmit={(e) => {
          void submit(e);
        }}
        data-testid="add-custom-section-form"
        style={{
          maxWidth: 520,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--kp-space-md)',
        }}
      >
        <div>
          <label htmlFor="cmp-section-title" style={fieldLabelStyle}>
            {LABEL_SECTION_NAME}
          </label>
          <input
            id="cmp-section-title"
            data-testid="custom-section-title"
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
            placeholder={LABEL_SECTION_NAME_PH}
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="cmp-section-description" style={fieldLabelStyle}>
            {LABEL_WHAT_TO_TRACK}
          </label>
          <input
            id="cmp-section-description"
            data-testid="custom-section-description"
            type="text"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
            }}
            placeholder={LABEL_WHAT_TO_TRACK_PH}
            style={inputStyle}
          />
        </div>
        {error !== null && (
          <p
            data-testid="custom-section-error"
            role="alert"
            style={{ color: '#b91c1c', fontSize: 'var(--kp-font-sm)', margin: 0 }}
          >
            {error}
          </p>
        )}
        <div>
          <Button
            type="submit"
            variant="primary"
            size="md"
            iconLeft={Sparkles}
            data-testid="custom-section-submit"
            disabled={!title.trim() || busy}
            loading={busy}
          >
            {LABEL_ADD_SECTION_BTN}
          </Button>
        </div>
      </form>

      {templates.length > 0 && (
        <div
          style={{
            marginTop: 'var(--kp-space-xl)',
            borderTop: 'var(--kp-border-width) solid var(--color-border)',
            paddingTop: 'var(--kp-space-lg)',
            maxWidth: 520,
          }}
        >
          <Eyebrow>{LABEL_REUSE_TEMPLATE}</Eyebrow>
          <ul
            style={{
              listStyle: 'none',
              margin: 'var(--kp-space-sm) 0 0',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--kp-space-xs)',
            }}
          >
            {templates.map((tpl) => (
              <li
                key={tpl.id}
                data-testid="clientmap-template-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--kp-space-sm)',
                  padding: 'var(--kp-space-xs) var(--kp-space-sm)',
                  border: 'var(--kp-border-width) solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-background)',
                }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 'var(--kp-font-sm)',
                    fontWeight: 'var(--kp-weight-medium)',
                    color: 'var(--kp-navy)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tpl.title}
                </span>
                <Button
                  data-testid="clientmap-template-apply"
                  variant="secondary"
                  size="sm"
                  loading={applying === tpl.id}
                  disabled={applying !== null}
                  onClick={() => {
                    void applyTemplate(tpl.id);
                  }}
                >
                  {LABEL_USE_TEMPLATE}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── ClientMapPanel (main export) ──────────────────────────────────────────────

/**
 * Two-pane Client Map panel. Drop-in flag-gateable alternative to
 * `ClientMapView` — props are identical; swap at the call site behind a flag.
 *
 * What's folded in (so the parent does NOT need to render these separately):
 *   - Custom-section composer (the "+ New section" form + AI fill)
 *   - Saved-template list ("Reuse a saved template")
 *   - "What I'm missing" gap/assumptions/questions panel (incl. ClientQuestionsList)
 */
export function ClientMapPanel({
  map,
  onOpenSource,
  onEditItem,
  onAnswerQuestion,
  onFlagForClient,
  onStartInterview,
}: {
  map: ClientMap;
  onOpenSource: (r: SourceRef) => void;
  onEditItem: (sectionKey: string, itemId: string) => void;
  onAnswerQuestion?: (question: GapQuestion) => void;
  onFlagForClient?: (question: GapQuestion) => void;
  /** Toggle the guided-interview panel — rendered as a button at the rail bottom. */
  onStartInterview?: () => void;
}) {
  const removeSection = useClientMapStore((s) => s.removeSection);
  const saveTemplate = useTemplatesStore((s) => s.saveTemplate);

  // Build the ordered section list: core sections first (in spec order, with
  // empty shells for any that have not been filled yet), then custom sections.
  const coreSections: ClientMapSection[] = CORE_SECTION_ORDER.map(
    (key) =>
      map.sections.find((s) => s.key === key) ?? {
        id: key,
        kind: 'core' as const,
        key,
        title: CORE_SECTION_TITLE[key],
        items: [],
      },
  );
  const customSections = map.sections.filter((s) => s.kind === 'custom');
  const sectionList = [...coreSections, ...customSections];

  // Initialise the selected tab from localStorage, falling back to the first
  // section that actually has content (or the first section overall).
  const firstWithContent = sectionList.find((s) => s.items.length > 0)?.key;
  const [activeKey, setActiveKey] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(tabStorageKey(map.matterId));
      if (
        stored !== null &&
        (stored === MISSING_KEY ||
          stored === NEW_KEY ||
          sectionList.some((s) => s.key === stored))
      ) {
        return stored;
      }
    } catch {
      // localStorage unavailable (private browsing, embedded webview) — ignore.
    }
    return firstWithContent ?? sectionList[0]?.key ?? MISSING_KEY;
  });

  const select = (key: string): void => {
    setActiveKey(key);
    try {
      localStorage.setItem(tabStorageKey(map.matterId), key);
    } catch {
      // ignore
    }
  };

  const activeSection = sectionList.find((s) => s.key === activeKey);
  const missingCount = unresolvedAskGaps(map).length;

  // The Sources column reflects whatever the user is currently viewing: the
  // cited sources behind the active section's facts (or, on "What I'm missing",
  // the know/assuming facts). Empty on the "+ New section" composer.
  const activeSourceItems: ClientMapItem[] =
    activeKey === NEW_KEY
      ? []
      : activeKey === MISSING_KEY || activeSection === undefined
        ? [...map.completeness.know, ...map.completeness.assuming]
        : activeSection.items;
  const currentSources: AnswerCitation[] = sourcesForItems(activeSourceItems, map.matterId);
  // Keep each cited ref's FULL SourceRef (incl. kind) so the Sources-column
  // cards open through the SAME kind-aware dispatcher as the inline source chips.
  // The AnswerCitation shape keeps only the ref string, so without this lookup
  // CRM / OneDrive / e-sign / meeting sources would be dropped or misrouted to
  // the document opener.
  const sourceRefByRef = new Map<string, SourceRef>();
  for (const it of activeSourceItems) {
    for (const s of it.sources) {
      if (!sourceRefByRef.has(s.ref)) sourceRefByRef.set(s.ref, s);
    }
  }

  return (
    <div data-testid="clientmap-panel" style={shellStyle}>
      {/* Left rail — the sections list, then "What I'm missing", then (pinned to
          the BOTTOM) the two outlined action buttons: "+ New section" and below
          it "Start the guided interview". */}
      <div style={railStyle} role="tablist" aria-label="Client map sections">
        {sectionList.map((s) => (
          <TabButton
            key={s.key}
            testid={`clientmap-tab-${s.key}`}
            title={s.title}
            count={null}
            active={activeKey === s.key}
            accent={false}
            muted={s.items.length === 0}
            onClick={() => {
              select(s.key);
            }}
          />
        ))}

        {/* Light divider before the special "What I'm missing" view */}
        <div
          style={{
            height: 1,
            background: 'var(--kp-divider)',
            margin: 'var(--kp-space-xs) var(--kp-space-2xs)',
          }}
        />

        {/* "What I'm missing" — accent badge when there are open gaps */}
        <TabButton
          testid={`clientmap-tab-${MISSING_KEY}`}
          title={LABEL_WHAT_MISSING}
          count={null}
          active={activeKey === MISSING_KEY}
          accent={missingCount > 0}
          muted={missingCount === 0}
          onClick={() => {
            select(MISSING_KEY);
          }}
        />

        {/* Spacer pushes the action buttons to the bottom of the rail. */}
        <div style={{ flex: 1 }} />

        <Button
          variant="secondary"
          size="sm"
          iconLeft={Plus}
          fullWidth
          data-testid="clientmap-tab-add"
          onClick={() => {
            select(NEW_KEY);
          }}
          style={{ ...railActionButtonStyle, marginBottom: 'var(--kp-space-2xs)' }}
        >
          {LABEL_NEW_SECTION}
        </Button>

        {onStartInterview && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            iconLeft={Sparkles}
            fullWidth
            data-testid="clientmap-start-interview"
            onClick={onStartInterview}
            style={railActionButtonStyle}
          >
            {LABEL_START_INTERVIEW}
          </Button>
        )}
      </div>

      {/* Right reading pane — left-aligned, breathing reading column (Ask shape) */}
      <div style={contentStyle}>
        <div style={contentInnerStyle}>
          {activeKey === NEW_KEY ? (
            <AddSectionPanel
              matterId={map.matterId}
              onCreated={(key) => {
                select(key);
              }}
            />
          ) : activeKey === MISSING_KEY || activeSection === undefined ? (
            <MissingPanel
              map={map}
              onOpenSource={onOpenSource}
              onAnswerQuestion={onAnswerQuestion}
              onFlagForClient={onFlagForClient}
            />
          ) : (
            <SectionPanel
              section={activeSection}
              onOpenSource={onOpenSource}
              onEdit={(itemId) => {
                onEditItem(activeSection.key, itemId);
              }}
              onSaveTemplate={
                activeSection.kind === 'custom'
                  ? () => {
                      saveTemplate(
                        activeSection.title,
                        activeSection.prompt ?? activeSection.title,
                      );
                    }
                  : undefined
              }
              onDelete={
                activeSection.kind === 'custom'
                  ? () => {
                      removeSection(map.matterId, activeSection.id);
                      select(MISSING_KEY);
                    }
                  : undefined
              }
            />
          )}
        </div>
      </div>

      {/* SOURCES column — the SAME component + card design as the Ask tab. Shows
          the cited sources behind the facts the user is currently viewing, and
          updates as they switch sections / "What I'm missing". */}
      <div
        style={{
          width: 326,
          flex: 'none',
          borderLeft: '1px solid var(--kp-divider)',
          background: 'var(--kp-bg-soft)',
          overflowY: 'auto',
          padding: 'var(--kp-surface-gap) var(--kp-card-pad)',
        }}
      >
        <SourcePanel
          citations={currentSources}
          selectedN={null}
          onSelect={() => {}}
          onOpenCitation={(c) => {
            const ref = c.path != null ? sourceRefByRef.get(c.path) : undefined;
            if (ref) onOpenSource(ref);
          }}
        />
      </div>
    </div>
  );
}
