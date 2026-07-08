// src/features/matters/ClientMapPanel.tsx
//
// Two-pane Client Map panel — a flag-gateable drop-in alternative to
// ClientMapView.  Left rail = compact action icons, clickable vertical tabs
// (one per section), and "What I'm missing".  Right pane =
// the selected section with big title, blue-bullet item rows, source chips,
// quiet row menus, and the custom-section / template / gap panels folded in.
//
// It intentionally keeps ClientMapView's data contract while adding a few host
// callbacks for the simplified hub shell.

import { useId, useRef, useState, type CSSProperties } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Check, ChevronLeft, ChevronRight, MoreHorizontal, Plus, Sparkles, type LucideIcon } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Button, Chip, Eyebrow, CountBadge, TrustNote } from '@/ui/kp';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { CORE_SECTION_ORDER, CORE_SECTION_TITLE } from '@/platform/clientMap/types';
import {
  sourceChipLabel,
  hasImportedMeetingNoteSource,
} from '@/platform/clientMap/meetingNoteSources';
import type {
  ClientMap,
  ClientMapItem,
  ClientMapSection,
  SourceRef,
  GapQuestion,
} from '@/platform/clientMap/types';
import { flagForClient, unresolvedAskGaps, displayCompleteness } from '@/features/matters/clientMap/guidedInterview';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { buildCustomSection } from '@/features/matters/clientMap/customSection';
import { useTemplatesStore, applyTemplateToMatter } from '@/features/matters/clientMap/templatesStore';
import { ClientQuestionsList } from '@/features/matters/ClientQuestionsList';
import { GuidedInterview } from '@/features/matters/GuidedInterview';
import { SourcePanel } from '@/features/ask/SourcePanel';
import type { AnswerCitation } from '@/features/ask/askHelpers';
import { skClientMapSourcesCollapsed, skClientMapTab } from '@/config/identity';
import type { AuditEntry } from '@/platform/types/audit';

// ── Sources column helpers ────────────────────────────────────────────────────
// Map the Client Map's cited sources (SourceRef) onto the Ask SourcePanel's
// AnswerCitation shape so the SAME Sources column + card design is reused.
function sourceBasename(ref: string): string {
  const clean = ref.split('?')[0] ?? ref;
  const seg = clean.split('/').pop() ?? clean;
  return seg || clean;
}
function extensionFromSourceRef(ref: string): string | undefined {
  const clean = ref.split(/[?#]/)[0] ?? ref;
  const name = clean.split(/[\\/]/).pop() ?? clean;
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot >= name.length - 1) return undefined;
  return name.slice(dot + 1).toLowerCase();
}
function sourceTypeForSourceRef(source: SourceRef): string | undefined {
  if (source.kind === 'document') return extensionFromSourceRef(source.ref) ?? 'document';
  if (source.kind === 'email') return 'mail';
  return source.kind;
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
      const sourceType = sourceTypeForSourceRef(s);
      if (sourceType !== undefined) c.sourceType = sourceType;
      if (s.citationId !== undefined) c.id = s.citationId;
      out.push(c);
    }
  }
  return out;
}

// ── Display strings (variables avoid hardcoded JSX text for the i18n rule) ────

const railTopActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 2px var(--kp-space-sm)',
};

const railTabsStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const railIconButtonStyle: CSSProperties = {
  width: 22,
  height: 22,
  border: 0,
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

function readSourcesCollapsedPreference(matterId: string): boolean {
  try {
    const stored = localStorage.getItem(skClientMapSourcesCollapsed(matterId));
    return stored === null ? true : stored === '1';
  } catch {
    return true;
  }
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
  minHeight: 0,
  borderRight: '1px solid var(--kp-divider)',
  background: 'var(--color-background)',
  padding: '14px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  overflowY: 'auto',
};

// Content matches Ask's conversation column: full surface gutter (32px) on the
// left, comfortable top padding, and a left-aligned reading column capped to a
// readable measure (no centered "strange right margin").
const contentStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
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
  const { t } = useTranslation();
  const label = sourceChipLabel(source);
  return (
    <Chip
      data-testid="clientmap-source-link"
      size="sm"
      style={sourceChipStyle}
      aria-label={t('matter.client-map.source-chip-label', { label })}
      onClick={() => {
        onOpenSource(source);
      }}
    >
      {label}
    </Chip>
  );
}

function completenessLevelLabel(level: ClientMap['completeness']['level'], t: (key: string) => string): string {
  switch (level) {
    case 'thin':
      return t('matter.client-map.level.thin');
    case 'getting-there':
      return t('matter.client-map.level.getting-there');
    case 'solid':
      return t('matter.client-map.level.solid');
  }
}

// ── ItemRow ───────────────────────────────────────────────────────────────────

function ItemRow({
  item,
  onOpenSource,
  onEdit,
  onRemove,
  showAssumptionLabel = true,
}: {
  item: ClientMapItem;
  onOpenSource: (r: SourceRef) => void;
  onEdit?: () => void;
  onRemove?: () => void;
  showAssumptionLabel?: boolean;
}) {
  const { t } = useTranslation();
  const hasMenu = onEdit != null || onRemove != null;
  const hasMeta = item.sources.length > 0 || (item.isAssumption && showAssumptionLabel);
  return (
    <div data-testid="clientmap-item" className="group" style={itemRowStyle}>
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
            {item.isAssumption && showAssumptionLabel && (
              <span
                data-testid="clientmap-item-assumption"
                style={{ ...mutedTextStyle, fontSize: 'var(--kp-font-xs)' }}
              >
                {t('matter.client-map.assuming')}
              </span>
            )}
            {item.sources.map((s, i) => (
              <SourceChip key={i} source={s} onOpenSource={onOpenSource} />
            ))}
          </div>
        )}
      </div>
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="clientmap-item-menu"
              aria-label={t('matter.client-map.row-actions')}
              className="kp-icon-btn kp-icon-btn--ghost kp-icon-btn--xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100"
              style={{ flex: 'none', marginTop: 1 }}
            >
              <MoreHorizontal size={14} strokeWidth={1.75} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            {onEdit != null && (
              <DropdownMenuItem
                data-testid="clientmap-item-edit"
                onSelect={onEdit}
              >
                {t('matter.client-map.edit')}
              </DropdownMenuItem>
            )}
            {onRemove != null && (
              <DropdownMenuItem
                data-testid="clientmap-item-remove"
                className="text-destructive focus:text-destructive"
                onSelect={onRemove}
              >
                {t('matter.client-map.remove')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
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
  separated,
  onClick,
}: {
  testid: string;
  title: string;
  count: number | null;
  active: boolean;
  accent: boolean;
  muted: boolean;
  separated?: boolean;
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
        marginTop: separated ? 'var(--kp-space-xs)' : 0,
        textAlign: 'left',
        padding: '10px 12px',
        border: '1px solid transparent',
        borderTopColor: separated ? 'var(--kp-divider)' : 'transparent',
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

function RailIconActionButton({
  icon: Icon,
  label,
  testid,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  testid: string;
  onClick: () => void;
}) {
  const contentId = useId();
  const [open, setOpen] = useState(false);

  const show = () => {
    setOpen(true);
  };

  const hide = () => {
    setOpen(false);
  };

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-describedby={open ? contentId : undefined}
            data-testid={testid}
            className="kp-icon-btn kp-icon-btn--ghost kp-icon-btn--xs"
            style={railIconButtonStyle}
            onMouseEnter={show}
            onMouseLeave={hide}
            onFocus={show}
            onBlur={hide}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                hide();
              }
            }}
            onClick={() => {
              hide();
              onClick();
            }}
          >
            <Icon size={15} strokeWidth={2} aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent id={contentId} side="bottom">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
  onRemoveItem,
  onAddItem,
  onSaveTemplate,
  onDelete,
  onViewHistory,
}: {
  section: ClientMapSection;
  onOpenSource: (r: SourceRef) => void;
  onEdit: (itemId: string) => void;
  onRemoveItem: (itemId: string) => void;
  onAddItem: (text: string) => void;
  onSaveTemplate?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onViewHistory: () => void;
}) {
  const { t } = useTranslation();
  const isCustom = section.kind === 'custom';
  const [newBullet, setNewBullet] = useState('');
  const [addingFact, setAddingFact] = useState(false);
  // Wave 0: filter this section's facts down to the ones cited to imported
  // meeting notes (Jump exports, Zocks connector, local meetings). The chip
  // only appears when the section actually has such an item.
  const [meetingNotesOnly, setMeetingNotesOnly] = useState(false);
  const meetingNoteCount = section.items.filter(hasImportedMeetingNoteSource).length;
  const visibleItems =
    meetingNotesOnly && meetingNoteCount > 0
      ? section.items.filter(hasImportedMeetingNoteSource)
      : section.items;
  return (
    <div data-testid={`clientmap-section-${section.key}`}>
      <PanelHeader title={section.title} count={section.items.length}>
        {meetingNoteCount > 0 && (
          <Chip
            size="sm"
            data-testid="clientmap-filter-meeting-notes"
            active={meetingNotesOnly}
            onClick={() => { setMeetingNotesOnly((v) => !v); }}
          >
            {t('matter.client-map.meetings-filter', { count: meetingNoteCount })}
          </Chip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="clientmap-section-menu"
              aria-label={t('matter.client-map.section-actions')}
              className="kp-icon-btn kp-icon-btn--ghost kp-icon-btn--sm"
            >
              <MoreHorizontal size={15} strokeWidth={1.75} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              data-testid="clientmap-section-history"
              onSelect={onViewHistory}
            >
              {t('matter.client-map.view-section-history')}
            </DropdownMenuItem>
            {isCustom && onSaveTemplate != null && (
              <DropdownMenuItem
                data-testid="clientmap-section-save-template"
                onSelect={onSaveTemplate}
              >
                {t('matter.client-map.save-as-template')}
              </DropdownMenuItem>
            )}
            {isCustom && onDelete != null && (
              <DropdownMenuItem
                data-testid="clientmap-section-delete"
                className="text-destructive focus:text-destructive"
                onSelect={onDelete}
              >
                {t('matter.client-map.remove-section')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </PanelHeader>
      {section.items.length > 0 ? (
        <div>
          {visibleItems.map((it) => (
            <ItemRow
              key={it.id}
              item={it}
              onOpenSource={onOpenSource}
              onEdit={() => {
                onEdit(it.id);
              }}
              onRemove={() => {
                onRemoveItem(it.id);
              }}
            />
          ))}
        </div>
      ) : (
        <div style={mutedTextStyle}>{t('matter.client-map.section-empty')}</div>
      )}
      {addingFact ? (
        <form
          data-testid="clientmap-add-bullet-form"
          onSubmit={(e) => {
            e.preventDefault();
            const text = newBullet.trim();
            if (!text) return;
            onAddItem(text);
            setNewBullet('');
            setAddingFact(false);
          }}
          style={{
            marginTop: 'var(--kp-space-lg)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--kp-space-xs)',
          }}
        >
          <input
            data-testid="clientmap-add-bullet-input"
            type="text"
            value={newBullet}
            onChange={(e) => { setNewBullet(e.target.value); }}
            placeholder={t('matter.client-map.add-fact')}
            style={{ ...inputStyle, height: 36, flex: 1 }}
            autoFocus
          />
          <Button
            type="submit"
            data-testid="clientmap-add-bullet-submit"
            variant="secondary"
            size="sm"
            disabled={!newBullet.trim()}
          >
            {t('matter.client-map.add')}
          </Button>
        </form>
      ) : (
        <button
          type="button"
          data-testid="clientmap-add-fact-row"
          onClick={() => { setAddingFact(true); }}
          style={{
            marginTop: 'var(--kp-space-lg)',
            width: '100%',
            border: 0,
            background: 'transparent',
            color: 'var(--color-muted-foreground)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--kp-space-xs)',
            padding: '8px 0',
            fontSize: 'var(--kp-font-sm)',
            fontWeight: 'var(--kp-weight-semibold)',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <Plus size={14} strokeWidth={1.75} aria-hidden />
          {t('matter.client-map.add-fact-row')}
        </button>
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
  const { t } = useTranslation();
  const [interviewOpen, setInterviewOpen] = useState(false);
  // Recomputed against unresolved gaps only (Codex review of D1): otherwise the
  // level chip can stay stuck (e.g. "Getting there") after every remaining gap
  // has been answered or flagged, even though nothing is outstanding anymore.
  const c = displayCompleteness(map);
  const askGaps = c.ask;
  const hasGaps = askGaps.length > 0;
  const hasAssumptions = c.assuming.length > 0;
  return (
    <div data-testid="clientmap-completeness">
      <PanelHeader title={t('matter.client-map.missing-title')}>
        <Chip data-testid="clientmap-completeness-level" size="sm">
          {completenessLevelLabel(c.level, t)}
        </Chip>
      </PanelHeader>

      <TrustNote
        data-testid="clientmap-coverage-caveat"
        details={t('matter.client-map.coverage-caveat-full')}
        style={{ marginBottom: 'var(--kp-space-md)' }}
      >
        {t('matter.client-map.coverage-caveat-short')}
      </TrustNote>

      {hasGaps && (
        <div style={{ marginBottom: hasAssumptions ? 'var(--kp-space-lg)' : 0 }}>
          <Button
            type="button"
            data-testid="clientmap-start-interview"
            variant="secondary"
            size="sm"
            style={{ marginBottom: 'var(--kp-space-sm)' }}
            onClick={() => { setInterviewOpen(true); }}
          >
            {t('matter.client-map.answer-one-by-one')}
          </Button>
          {interviewOpen && (
            <div style={{ marginBottom: 'var(--kp-space-md)' }}>
              <GuidedInterview matterId={map.matterId} onClose={() => { setInterviewOpen(false); }} />
            </div>
          )}
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
                {t('matter.client-map.answer')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    data-testid="clientmap-ask-menu"
                    aria-label={t('matter.client-map.question-actions')}
                    className="kp-icon-btn kp-icon-btn--ghost kp-icon-btn--xs"
                  >
                    <MoreHorizontal size={14} strokeWidth={1.75} aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem
                    data-testid="clientmap-ask-flag"
                    onSelect={() => {
                      if (onFlagForClient) {
                        onFlagForClient(q);
                      } else {
                        flagForClient(map.matterId, q.text);
                      }
                    }}
                  >
                    {t('matter.client-map.ask-client')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      {hasAssumptions && (
        <div style={{ marginBottom: 'var(--kp-space-lg)' }}>
          <Eyebrow>{t('matter.client-map.assumptions-title')}</Eyebrow>
          <div>
            {c.assuming.map((it) => (
              <ItemRow key={it.id} item={it} onOpenSource={onOpenSource} showAssumptionLabel={false} />
            ))}
          </div>
        </div>
      )}

      {!hasGaps && !hasAssumptions && (
        <div style={{ ...mutedTextStyle, marginBottom: 'var(--kp-space-lg)' }}>
          {t('matter.client-map.map-complete')}
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
  onAuditLog,
}: {
  matterId: string;
  onCreated: (key: string) => void;
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addCustomSection = useClientMapStore((s) => s.addCustomSection);
  const mergeSectionItems = useClientMapStore((s) => s.mergeSectionItems);
  const removeSectionSilently = useClientMapStore((s) => s.removeSectionSilently);
  const templates = useTemplatesStore(useShallow((s) => Object.values(s.templates)));
  const [applying, setApplying] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    const sectionId = uuidv4();
    const sectionTitle = title.trim();
    const p = prompt.trim() || sectionTitle;
    addCustomSection(matterId, {
      id: sectionId,
      kind: 'custom',
      key: sectionId,
      title: sectionTitle,
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
          title: sectionTitle,
          prompt: p,
          scope: 'matter',
          items: [
            {
              id: uuidv4(),
              text: t('matter.client-map.preview-tracking', { prompt: p }),
              origin: 'ai',
              isAssumption: false,
              sources: [],
              updatedAt: new Date().toISOString(),
            },
            {
              id: uuidv4(),
              text: t('matter.client-map.preview-updated'),
              origin: 'ai',
              isAssumption: false,
              sources: [],
              updatedAt: new Date().toISOString(),
            },
          ],
        };
      } else {
        populated = await buildCustomSection(matterId, sectionId, sectionTitle, p, onAuditLog ? { onAuditLog } : undefined);
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
      removeSectionSilently(matterId, sectionId);
      setError(t('matter.client-map.section-error'));
    } finally {
      setBusy(false);
    }
  }

  async function applyTemplate(templateId: string): Promise<void> {
    if (applying) return;
    setApplying(templateId);
    try {
      await applyTemplateToMatter(templateId, matterId, onAuditLog ? { onAuditLog } : undefined);
    } finally {
      setApplying(null);
    }
  }

  return (
    <div data-testid="clientmap-new-section">
      <PanelHeader title={t('matter.client-map.add-section-heading')} />
      <p
        style={{
          ...mutedTextStyle,
          marginTop: 0,
          marginBottom: 'var(--kp-space-md)',
          maxWidth: 520,
        }}
      >
        {t('matter.client-map.add-section-body')}
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
            {t('matter.client-map.section-name')}
          </label>
          <input
            id="cmp-section-title"
            data-testid="custom-section-title"
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
            placeholder={t('matter.client-map.section-name-placeholder')}
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="cmp-section-description" style={fieldLabelStyle}>
            {t('matter.client-map.track-label')}
          </label>
          <input
            id="cmp-section-description"
            data-testid="custom-section-description"
            type="text"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
            }}
            placeholder={t('matter.client-map.track-placeholder')}
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
            {t('matter.client-map.add-section-submit')}
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
          <Eyebrow>{t('matter.client-map.saved-templates')}</Eyebrow>
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
                  borderRadius: 'var(--radius-sm)',
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
                  iconLeft={Check}
                  loading={applying === tpl.id}
                  disabled={applying !== null}
                  onClick={() => {
                    void applyTemplate(tpl.id);
                  }}
                >
                  {t('matter.client-map.apply-template')}
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
  onViewSectionHistory,
  onAuditLog,
}: {
  map: ClientMap;
  onOpenSource: (r: SourceRef) => void;
  onEditItem: (sectionKey: string, itemId: string) => void;
  onAnswerQuestion?: (question: GapQuestion) => void;
  onFlagForClient?: (question: GapQuestion) => void;
  onViewSectionHistory?: (sectionKey: string, sectionTitle: string) => void;
  /** Audit sink for custom-section builds (Trust-fixes finding #1) — threaded
   *  down to AddSectionPanel so a custom section or applied template records
   *  an egress entry before it sends this client's context to an AI provider. */
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
}) {
  const { t } = useTranslation();
  const removeSection = useClientMapStore((s) => s.removeSection);
  const removeItem = useClientMapStore((s) => s.removeItem);
  const addUserItem = useClientMapStore((s) => s.addUserItem);
  const saveTemplate = useTemplatesStore((s) => s.saveTemplate);
  const { confirm, dialogProps } = useConfirmDialog();
  const sourcesPaneRef = useRef<HTMLDivElement | null>(null);
  const [selectedSourceN, setSelectedSourceN] = useState<number | null>(null);

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
  const missingCount = unresolvedAskGaps(map).length;

  // Fresh opens now land on Household, the first core section. A remembered tab
  // still wins on revisit. Open gaps stay discoverable through the rail's
  // "What I'm missing" tab instead of stealing first focus.
  const [activeKey, setActiveKey] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(tabStorageKey(map.matterId));
      if (
        stored !== null &&
        (stored === MISSING_KEY ||
          sectionList.some((s) => s.key === stored))
      ) {
        return stored;
      }
    } catch {
      // localStorage unavailable (private browsing, embedded webview) — ignore.
    }
    return sectionList[0]?.key ?? MISSING_KEY;
  });
  const [sourcesCollapseState, setSourcesCollapseState] = useState(() => ({
    matterId: map.matterId,
    collapsed: readSourcesCollapsedPreference(map.matterId),
  }));
  const sourcesCollapsed =
    sourcesCollapseState.matterId === map.matterId
      ? sourcesCollapseState.collapsed
      : readSourcesCollapsedPreference(map.matterId);

  const select = (key: string): void => {
    setActiveKey(key);
    setSelectedSourceN(null);
    if (key === NEW_KEY) return;
    try {
      localStorage.setItem(tabStorageKey(map.matterId), key);
    } catch {
      // ignore
    }
  };

  const activeSection = sectionList.find((s) => s.key === activeKey);
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

  const setSourcesCollapsedPreference = (collapsed: boolean): void => {
    try {
      localStorage.setItem(skClientMapSourcesCollapsed(map.matterId), collapsed ? '1' : '0');
    // eslint-disable-next-line lantern-async/no-silent-failure -- Keep the in-memory preference if browser storage is unavailable.
    } catch {
      // localStorage unavailable — keep the in-memory preference for this view.
    }
    setSourcesCollapseState({ matterId: map.matterId, collapsed });
  };

  const toggleSourcesCollapsed = (): void => {
    setSourcesCollapseState((current) => {
      const currentCollapsed =
        current.matterId === map.matterId
          ? current.collapsed
          : readSourcesCollapsedPreference(map.matterId);
      const next = !currentCollapsed;
      try {
        localStorage.setItem(skClientMapSourcesCollapsed(map.matterId), next ? '1' : '0');
      // eslint-disable-next-line lantern-async/no-silent-failure -- Keep the in-memory preference if browser storage is unavailable.
      } catch {
        // localStorage unavailable — keep the in-memory preference for this view.
      }
      return { matterId: map.matterId, collapsed: next };
    });
  };

  const showSourceInPane = (source: SourceRef): void => {
    const citation = currentSources.find((c) => c.path === source.ref || c.id === source.citationId);
    if (citation !== undefined) {
      setSelectedSourceN(citation.n);
    }
    setSourcesCollapsedPreference(false);
    window.setTimeout(() => {
      if (citation === undefined) return;
      const card = sourcesPaneRef.current?.querySelector<HTMLElement>(
        `[data-testid="source-card"][data-cite="${String(citation.n)}"]`,
      );
      card?.scrollIntoView({ block: 'nearest' });
    }, 0);
  };

  return (
    <div data-testid="clientmap-panel" style={shellStyle}>
      {/* Left rail: compact action icons, then sections, then "What I'm missing". */}
      <div style={railStyle}>
        <div style={railTopActionsStyle}>
          <RailIconActionButton
            icon={Plus}
            label={t('matter.client-map.new-section')}
            testid="clientmap-tab-add"
            onClick={() => {
              select(NEW_KEY);
            }}
          />
        </div>

        <div style={railTabsStyle} role="tablist" aria-label="Client map sections">
          {sectionList.map((s) => (
            <TabButton
              key={s.key}
              testid={`clientmap-tab-${s.key}`}
              title={s.key === 'money' ? t('matter.client-map.rail-money') : s.title}
              count={null}
              active={activeKey === s.key}
              accent={false}
              muted={s.items.length === 0}
              onClick={() => {
                select(s.key);
              }}
            />
          ))}

          {/* "What I'm missing" — accent badge when there are open gaps */}
          <TabButton
            testid={`clientmap-tab-${MISSING_KEY}`}
            title={t('matter.client-map.rail-missing')}
            count={missingCount > 0 ? missingCount : null}
            active={activeKey === MISSING_KEY}
            accent={missingCount > 0}
            muted={missingCount === 0}
            separated
            onClick={() => {
              select(MISSING_KEY);
            }}
          />
        </div>
      </div>

      {/* Right reading pane — left-aligned, breathing reading column (Ask shape) */}
      <div data-testid="clientmap-panel-scroll" style={contentStyle}>
        <div style={contentInnerStyle}>
          {activeKey === NEW_KEY ? (
            <AddSectionPanel
              matterId={map.matterId}
              onCreated={(key) => {
                select(key);
              }}
              {...(onAuditLog ? { onAuditLog } : {})}
            />
          ) : activeKey === MISSING_KEY || activeSection === undefined ? (
            <MissingPanel
              map={map}
              onOpenSource={showSourceInPane}
              onAnswerQuestion={onAnswerQuestion}
              onFlagForClient={onFlagForClient}
            />
          ) : (
            <SectionPanel
              section={activeSection}
              onOpenSource={showSourceInPane}
              onEdit={(itemId) => {
                onEditItem(activeSection.key, itemId);
              }}
              onRemoveItem={(itemId) => {
                void (async () => {
                  const ok = await confirm(t('matter.client-map.remove-bullet-desc'), {
                    title: t('matter.client-map.remove-bullet-title'),
                    confirmLabel: t('matter.client-map.remove'),
                    cancelLabel: t('matter.client-map.keep-it'),
                    variant: 'destructive',
                  });
                  if (ok) removeItem(map.matterId, activeSection.key, itemId);
                })().catch((error: unknown) => {
                  console.error('Failed to remove Client Map bullet:', error);
                });
              }}
              onAddItem={(text) => {
                addUserItem(map.matterId, activeSection.key, text);
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
                      void (async () => {
                        const ok = await confirm(t('matter.client-map.remove-section-desc'), {
                          title: t('matter.client-map.remove-section-title'),
                          confirmLabel: t('matter.client-map.remove-section'),
                          cancelLabel: t('matter.client-map.keep-section'),
                          variant: 'destructive',
                        });
                        if (ok) {
                          removeSection(map.matterId, activeSection.id);
                          select(MISSING_KEY);
                        }
                      })().catch((error: unknown) => {
                        console.error('Failed to remove Client Map section:', error);
                      });
                    }
                  : undefined
              }
              onViewHistory={() => {
                onViewSectionHistory?.(activeSection.key, activeSection.title);
              }}
            />
          )}
        </div>
      </div>

      {/* SOURCES column — the SAME component + card design as the Ask tab. Shows
          the cited sources behind the facts the user is currently viewing, and
          updates as they switch sections / "What I'm missing". */}
      <div
        ref={sourcesPaneRef}
        data-testid="clientmap-sources-pane"
        data-collapsed={sourcesCollapsed ? 'true' : 'false'}
        style={{
          width: sourcesCollapsed ? 48 : 326,
          flex: 'none',
          borderLeft: '1px solid var(--kp-divider)',
          background: 'var(--kp-bg-soft)',
          overflowY: 'auto',
          padding: sourcesCollapsed
            ? 'var(--kp-space-sm) var(--kp-space-xs)'
            : 'var(--kp-surface-gap) var(--kp-card-pad)',
          transition: 'width 0.12s ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: sourcesCollapsed ? 'center' : 'flex-end',
            marginBottom: sourcesCollapsed ? 0 : 'var(--kp-space-sm)',
          }}
        >
          <button
            type="button"
            data-testid="clientmap-sources-toggle"
            aria-label={t('ask.sources.title')}
            aria-expanded={!sourcesCollapsed}
            title={t('ask.sources.title')}
            className="kp-icon-btn kp-icon-btn--ghost kp-icon-btn--sm"
            onClick={toggleSourcesCollapsed}
          >
            {sourcesCollapsed ? (
              <ChevronLeft size={14} strokeWidth={1.75} aria-hidden />
            ) : (
              <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
            )}
          </button>
        </div>
        {!sourcesCollapsed && (
          <SourcePanel
            citations={currentSources}
            selectedN={selectedSourceN}
            onSelect={setSelectedSourceN}
            onOpenCitation={(c) => {
              const ref = c.path != null ? sourceRefByRef.get(c.path) : undefined;
              if (ref) onOpenSource(ref);
            }}
          />
        )}
      </div>
      <ConfirmDialog {...dialogProps} data-testid="clientmap-confirm-dialog" />
    </div>
  );
}
