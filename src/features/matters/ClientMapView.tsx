// src/features/matters/ClientMapView.tsx
//
// Vertical-tab Client Map, built on the kp design system (tokens for every
// size + space; kp components for the controls). Sections are tabs down the
// left; selecting one fills a generous content area on the right. The last
// tabs are the honest "what I'm missing" view and a "+ New section" composer
// where the user names a section and the AI fills it from the client's files.
import { useState, type CSSProperties } from 'react';
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
import { flagForClient } from '@/platform/clientMap/guidedInterview';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { buildCustomSection } from '@/platform/clientMap/customSection';
import { useTemplatesStore, applyTemplateToMatter } from '@/platform/clientMap/templatesStore';
import { ClientQuestionsList } from '@/features/matters/ClientQuestionsList';

const LEVEL_LABEL: Record<CompletenessLevel, string> = {
  thin: 'Thin',
  'getting-there': 'Getting there',
  solid: 'Solid',
};

const MISSING_KEY = '__missing';
const NEW_KEY = '__new';
const IS_TEST = typeof window !== 'undefined' && window.location.search.includes('testMode');

function tabStorageKey(matterId: string): string {
  return `keepance:clientmap-tab:${matterId}`;
}

// ── Styles (every value from a token) ────────────────────────────────────────
const shellStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  border: 'var(--kp-border-width) solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
  background: 'var(--color-background)',
  minHeight: 400,
  boxShadow: 'var(--kp-shadow-1)',
};
const railStyle: CSSProperties = {
  width: 232,
  flex: 'none',
  borderRight: 'var(--kp-border-width) solid var(--color-border)',
  background: 'var(--color-muted)',
  padding: 'var(--kp-space-xs)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--kp-space-2xs)',
};
const contentStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: 'var(--kp-card-pad)',
  overflowY: 'auto',
};
const panelTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--kp-font-xl)',
  fontWeight: 'var(--kp-weight-bold)',
  color: 'var(--kp-navy)',
  fontFamily: 'var(--font-sans)',
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
  padding: 'var(--kp-space-sm) 0',
  borderBottom: 'var(--kp-border-width) solid var(--color-border)',
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

// ── Item + source ────────────────────────────────────────────────────────────

function SourceChip({ source, onOpenSource }: { source: SourceRef; onOpenSource: (r: SourceRef) => void }) {
  const label = `${source.kind === 'email' ? 'email' : 'source'}${source.locator != null ? ` ${source.locator}` : ''}`;
  return (
    <Chip
      data-testid="clientmap-source-link"
      size="sm"
      style={sourceChipStyle}
      aria-label={`Open ${label}`}
      onClick={() => { onOpenSource(source); }}
    >
      {label}
    </Chip>
  );
}

function ItemRow({ item, onOpenSource, onEdit }: { item: ClientMapItem; onOpenSource: (r: SourceRef) => void; onEdit?: () => void }) {
  const hasMeta = item.sources.length > 0 || onEdit != null || item.isAssumption;
  return (
    <div data-testid="clientmap-item" style={itemRowStyle}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--kp-blue)', marginTop: 9, flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={itemTextStyle}>{item.text}</span>
        {hasMeta && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-xs)', marginTop: 'var(--kp-space-xs)', flexWrap: 'wrap' }}>
            {item.isAssumption && (
              /* eslint-disable-next-line keepance-i18n/no-hardcoded-string */
              <span data-testid="clientmap-item-assumption" style={{ ...mutedTextStyle, fontSize: 'var(--kp-font-xs)' }}>assuming</span>
            )}
            {item.sources.map((s, i) => (
              <SourceChip key={i} source={s} onOpenSource={onOpenSource} />
            ))}
            {onEdit != null && (
              <Button type="button" data-testid="clientmap-item-edit" variant="ghost" size="sm" style={editButtonStyle} onClick={onEdit}>
                {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
                Edit
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Left-rail tab ────────────────────────────────────────────────────────────

function TabButton({
  testid, title, count, active, accent, muted, onClick,
}: {
  testid: string; title: string; count: number | null; active: boolean; accent: boolean; muted: boolean; onClick: () => void;
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
        padding: 'var(--kp-space-xs) var(--kp-space-sm)',
        border: 0,
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        position: 'relative',
        background: active ? 'var(--color-background)' : 'transparent',
        boxShadow: active ? 'var(--kp-shadow-1)' : 'none',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {active && <span style={{ position: 'absolute', left: 0, top: 'var(--kp-space-xs)', bottom: 'var(--kp-space-xs)', width: 3, borderRadius: 3, background: 'var(--kp-grad)' }} />}
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
      {count !== null && (accent ? <CountBadge count={count} /> : <span style={mutedCountStyle}>{count}</span>)}
    </button>
  );
}

// ── Right panels ─────────────────────────────────────────────────────────────

function PanelHeader({ title, count, children }: { title: string; count?: number; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-sm)', marginBottom: 'var(--kp-space-md)' }}>
      <h3 style={panelTitleStyle}>{title}</h3>
      {count !== undefined && <span style={mutedCountStyle}>{count}</span>}
      <div style={{ flex: 1 }} />
      {children}
    </div>
  );
}

function SectionPanel({
  section, onOpenSource, onEdit, onSaveTemplate, onDelete,
}: {
  section: ClientMapSection;
  onOpenSource: (r: SourceRef) => void;
  onEdit: (itemId: string) => void;
  onSaveTemplate?: () => void;
  onDelete?: () => void;
}) {
  const isCustom = section.kind === 'custom';
  return (
    <div data-testid={`clientmap-section-${section.key}`}>
      <PanelHeader title={section.title} count={section.items.length}>
        {isCustom && onSaveTemplate && (
          <Button type="button" variant="ghost" size="sm" data-testid="clientmap-section-save-template" onClick={onSaveTemplate}>
            {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
            Save as template
          </Button>
        )}
        {isCustom && onDelete && (
          <Button type="button" variant="ghost" size="sm" iconLeft={Trash2} data-testid="clientmap-section-delete" onClick={onDelete}>
            {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
            Remove
          </Button>
        )}
      </PanelHeader>
      {section.items.length > 0 ? (
        <div>
          {section.items.map((it) => (
            <ItemRow key={it.id} item={it} onOpenSource={onOpenSource} onEdit={() => { onEdit(it.id); }} />
          ))}
        </div>
      ) : (
        /* eslint-disable-next-line keepance-i18n/no-hardcoded-string */
        <div style={mutedTextStyle}>Nothing here yet — this section fills in as documents and email come in.</div>
      )}
    </div>
  );
}

function MissingPanel({
  map, onOpenSource, onAnswerQuestion, onFlagForClient,
}: {
  map: ClientMap;
  onOpenSource: (r: SourceRef) => void;
  onAnswerQuestion?: (question: GapQuestion) => void;
  onFlagForClient?: (question: GapQuestion) => void;
}) {
  const c = map.completeness;
  const hasGaps = c.ask.length > 0;
  const hasAssumptions = c.assuming.length > 0;
  return (
    <div data-testid="clientmap-completeness">
      <PanelHeader title="What I'm still missing">
        <Chip data-testid="clientmap-completeness-level" size="sm">{LEVEL_LABEL[c.level]}</Chip>
      </PanelHeader>

      {hasGaps && (
        <div style={{ marginBottom: hasAssumptions ? 'var(--kp-space-lg)' : 0 }}>
          {c.ask.map((q, i) => (
            <div key={i} data-testid="clientmap-ask" style={{ ...itemRowStyle, alignItems: 'center', gap: 'var(--kp-space-xs)' }}>
              <span style={{ ...itemTextStyle, flex: 1 }}>{q.text}</span>
              <Button data-testid="clientmap-ask-know" size="sm" variant="secondary" onClick={() => { onAnswerQuestion?.(q); }}>
                {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
                I know this
              </Button>
              <Button data-testid="clientmap-ask-flag" size="sm" variant="secondary" onClick={() => { if (onFlagForClient) { onFlagForClient(q); } else { flagForClient(map.matterId, q.text); } }}>
                {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
                Ask the client
              </Button>
            </div>
          ))}
        </div>
      )}

      {hasAssumptions && (
        <div style={{ marginBottom: 'var(--kp-space-lg)' }}>
          {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
          <Eyebrow>Working assumptions</Eyebrow>
          <div>{c.assuming.map((it) => <ItemRow key={it.id} item={it} onOpenSource={onOpenSource} />)}</div>
        </div>
      )}

      {!hasGaps && !hasAssumptions && (
        /* eslint-disable-next-line keepance-i18n/no-hardcoded-string */
        <div style={{ ...mutedTextStyle, marginBottom: 'var(--kp-space-lg)' }}>Nothing outstanding — this map looks complete.</div>
      )}

      {/* Questions you've flagged to take to the client live here, with the gaps. */}
      <ClientQuestionsList matterId={map.matterId} />
    </div>
  );
}

function AddSectionPanel({ matterId, onCreated }: { matterId: string; onCreated: (key: string) => void }) {
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addCustomSection = useClientMapStore((s) => s.addCustomSection);
  const setMap = useClientMapStore((s) => s.setMap);
  const getMap = useClientMapStore((s) => s.getMap);
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
    addCustomSection(matterId, { id: sectionId, kind: 'custom', key: sectionId, title: t, prompt: p, scope: 'matter', items: [] });
    try {
      let populated: ClientMapSection;
      if (IS_TEST) {
        // Preview/demo: no AI provider, so synthesize a believable fill so the
        // "+ New section" flow is demonstrable end-to-end.
        populated = {
          id: sectionId, kind: 'custom', key: sectionId, title: t, prompt: p, scope: 'matter',
          items: [
            { id: uuidv4(), text: `Tracking: ${p}.`, origin: 'ai', isAssumption: false, sources: [], updatedAt: new Date().toISOString() },
            { id: uuidv4(), text: 'Keepance keeps this updated from new documents and email.', origin: 'ai', isAssumption: false, sources: [], updatedAt: new Date().toISOString() },
          ],
        };
      } else {
        populated = await buildCustomSection(matterId, sectionId, t, p);
      }
      const map = getMap(matterId);
      if (map) {
        setMap(matterId, { ...map, sections: map.sections.map((sec) => (sec.id === sectionId ? populated : sec)) });
      }
      setTitle('');
      setPrompt('');
      onCreated(sectionId);
    } catch {
      removeSection(matterId, sectionId);
      setError('Could not fill this section. Your AI provider may be unavailable, or no account key is set. Nothing was added — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function useTemplate(templateId: string): Promise<void> {
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
      <PanelHeader title="Add a section" />
      <p style={{ ...mutedTextStyle, marginTop: 0, marginBottom: 'var(--kp-space-md)', maxWidth: 520 }}>
        {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
        Name a section and say what to track. Keepance fills it in from this client&apos;s documents and email, with sources you can check.
      </p>

      <form onSubmit={(e) => { void submit(e); }} data-testid="add-custom-section-form" style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)' }}>
        <div>
          {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
          <label htmlFor="custom-section-title" style={fieldLabelStyle}>Section name</label>
          <input id="custom-section-title" data-testid="custom-section-title" type="text" value={title} onChange={(e) => { setTitle(e.target.value); }} placeholder="e.g. Insurance coverage" style={inputStyle} />
        </div>
        <div>
          {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
          <label htmlFor="custom-section-description" style={fieldLabelStyle}>What should I track here?</label>
          <input id="custom-section-description" data-testid="custom-section-description" type="text" value={prompt} onChange={(e) => { setPrompt(e.target.value); }} placeholder="e.g. policy types, coverage limits, and renewal dates" style={inputStyle} />
        </div>
        {error !== null && (
          <p data-testid="custom-section-error" role="alert" style={{ color: '#b91c1c', fontSize: 'var(--kp-font-sm)', margin: 0 }}>{error}</p>
        )}
        <div>
          <Button type="submit" variant="primary" size="md" iconLeft={Sparkles} data-testid="custom-section-submit" disabled={!title.trim() || busy} loading={busy}>
            {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
            Add section
          </Button>
        </div>
      </form>

      {templates.length > 0 && (
        <div style={{ marginTop: 'var(--kp-space-xl)', borderTop: 'var(--kp-border-width) solid var(--color-border)', paddingTop: 'var(--kp-space-lg)', maxWidth: 520 }}>
          {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
          <Eyebrow>Reuse a saved template</Eyebrow>
          <ul style={{ listStyle: 'none', margin: 'var(--kp-space-sm) 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-xs)' }}>
            {templates.map((tpl) => (
              <li key={tpl.id} data-testid="clientmap-template-row" style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-sm)', padding: 'var(--kp-space-xs) var(--kp-space-sm)', border: 'var(--kp-border-width) solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-background)' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-medium)', color: 'var(--kp-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tpl.title}</span>
                <Button data-testid="clientmap-template-apply" variant="secondary" size="sm" loading={applying === tpl.id} disabled={applying !== null} onClick={() => { void useTemplate(tpl.id); }}>
                  {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
                  Use
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export function ClientMapView({
  map, onOpenSource, onEditItem, onAnswerQuestion, onFlagForClient,
}: {
  map: ClientMap;
  onOpenSource: (r: SourceRef) => void;
  onEditItem: (sectionKey: string, itemId: string) => void;
  onAnswerQuestion?: (question: GapQuestion) => void;
  onFlagForClient?: (question: GapQuestion) => void;
}) {
  const removeSection = useClientMapStore((s) => s.removeSection);
  const saveTemplate = useTemplatesStore((s) => s.saveTemplate);

  const coreSections: ClientMapSection[] = CORE_SECTION_ORDER.map(
    (key) => map.sections.find((s) => s.key === key) ?? { id: key, kind: 'core', key, title: CORE_SECTION_TITLE[key], items: [] },
  );
  const customSections = map.sections.filter((s) => s.kind === 'custom');
  const sectionList = [...coreSections, ...customSections];

  const firstWithContent = sectionList.find((s) => s.items.length > 0)?.key;
  const [activeKey, setActiveKey] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(tabStorageKey(map.matterId));
      if (stored != null && (stored === MISSING_KEY || stored === NEW_KEY || sectionList.some((s) => s.key === stored))) {
        return stored;
      }
    } catch {
      // ignore
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
  const missingCount = map.completeness.ask.length;

  return (
    <div data-testid="clientmap-view" style={shellStyle}>
      {/* Left rail — section tabs */}
      <div style={railStyle} role="tablist" aria-label="Client map sections">
        {sectionList.map((s) => (
          <TabButton
            key={s.key}
            testid={`clientmap-tab-${s.key}`}
            title={s.title}
            count={s.items.length}
            active={activeKey === s.key}
            accent={false}
            muted={s.items.length === 0}
            onClick={() => { select(s.key); }}
          />
        ))}

        <div style={{ height: 'var(--kp-border-width)', background: 'var(--color-border)', margin: 'var(--kp-space-xs) var(--kp-space-2xs)' }} />

        <TabButton
          testid={`clientmap-tab-${MISSING_KEY}`}
          title="What I'm missing"
          count={missingCount}
          active={activeKey === MISSING_KEY}
          accent={missingCount > 0}
          muted={missingCount === 0}
          onClick={() => { select(MISSING_KEY); }}
        />

        {/* + New section — the user names it, the AI fills it. */}
        <button
          type="button"
          data-testid="clientmap-tab-add"
          onClick={() => { select(NEW_KEY); }}
          aria-selected={activeKey === NEW_KEY}
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--kp-space-xs)', width: '100%', textAlign: 'left',
            padding: 'var(--kp-space-xs) var(--kp-space-sm)', marginTop: 'var(--kp-space-2xs)',
            border: 'var(--kp-border-width) dashed var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
            background: activeKey === NEW_KEY ? 'var(--color-background)' : 'transparent',
            color: 'var(--kp-navy)', fontFamily: 'var(--font-sans)', fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)',
          }}
        >
          <Plus size={15} strokeWidth={2.25} style={{ flex: 'none' }} />
          {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
          <span>New section</span>
        </button>
      </div>

      {/* Right content area */}
      <div style={contentStyle}>
        {activeKey === NEW_KEY ? (
          <AddSectionPanel matterId={map.matterId} onCreated={(key) => { select(key); }} />
        ) : activeKey === MISSING_KEY || activeSection === undefined ? (
          <MissingPanel map={map} onOpenSource={onOpenSource} onAnswerQuestion={onAnswerQuestion} onFlagForClient={onFlagForClient} />
        ) : (
          <SectionPanel
            section={activeSection}
            onOpenSource={onOpenSource}
            onEdit={(itemId) => { onEditItem(activeSection.key, itemId); }}
            onSaveTemplate={
              activeSection.kind === 'custom'
                ? () => { saveTemplate(activeSection.title, activeSection.prompt ?? activeSection.title); }
                : undefined
            }
            onDelete={
              activeSection.kind === 'custom'
                ? () => { removeSection(map.matterId, activeSection.id); select(MISSING_KEY); }
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
