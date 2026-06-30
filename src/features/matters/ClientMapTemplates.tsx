// src/features/matters/ClientMapTemplates.tsx
//
// Lists personal reusable custom-category templates with apply and save affordances.
// Light theme only (no dark-mode styling).

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BookTemplate, Trash2 } from 'lucide-react';
import { Button, EmptyState } from '@/ui/kp';
import { useTemplatesStore, applyTemplateToMatter } from '@/platform/clientMap/templatesStore';

// ── Props ──────────────────────────────────────────────────────────────────

export interface ClientMapTemplatesProps {
  matterId: string;
  /** Called after a template is applied so the parent can refresh if needed. */
  onApplied?: () => void;
}

// ── Labels (intentional hardcoded strings — microcopy owned by this component) ──
const LABEL_APPLY = 'Apply to matter';
const LABEL_SAVE = 'Save as template';

// ── ClientMapTemplates ─────────────────────────────────────────────────────

export function ClientMapTemplates({ matterId, onApplied }: ClientMapTemplatesProps) {
  // useShallow: this selector derives a fresh array (Object.values) on every
  // call. Without a shallow equality check React's useSyncExternalStore sees a
  // new reference each render -> "getSnapshot should be cached" -> infinite
  // re-render loop -> "Maximum update depth exceeded" crash that white-screens
  // the whole app when the Client Map panel opens. (Matches aiChatStore.)
  const templates = useTemplatesStore(useShallow((s) => Object.values(s.templates)));
  const deleteTemplate = useTemplatesStore((s) => s.deleteTemplate);
  const saveTemplate = useTemplatesStore((s) => s.saveTemplate);

  // "Save this section as template" form state
  const [saveTitle, setSaveTitle] = useState('');
  const [savePrompt, setSavePrompt] = useState('');
  const [applying, setApplying] = useState<string | null>(null);

  async function handleApply(templateId: string) {
    if (applying) return;
    setApplying(templateId);
    try {
      await applyTemplateToMatter(templateId, matterId);
      onApplied?.();
    } finally {
      setApplying(null);
    }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!saveTitle.trim()) return;
    saveTemplate(saveTitle.trim(), savePrompt.trim() || saveTitle.trim());
    setSaveTitle('');
    setSavePrompt('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Template list ── */}
      <div>
        {templates.length === 0 ? (
          <EmptyState
            icon={BookTemplate}
            title="No saved templates yet"
            body="Save a custom section as a template to reuse it across matters."
          />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {templates.map((t) => (
              <li
                key={t.id}
                data-testid="clientmap-template-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  background: 'var(--color-surface)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--color-text)' }}>{t.title}</div>
                  {t.prompt && t.prompt !== t.title && (
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.prompt}
                    </div>
                  )}
                </div>
                <Button
                  data-testid="clientmap-template-apply"
                  variant="secondary"
                  size="sm"
                  loading={applying === t.id}
                  disabled={applying !== null}
                  onClick={() => { void handleApply(t.id); }}
                >
                  {LABEL_APPLY}
                </Button>
                <button
                  aria-label={`Delete template ${t.title}`}
                  onClick={() => { deleteTemplate(t.id); }}
                  style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', lineHeight: 0 }}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Save as template form ── */}
      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
        {/* eslint-disable-next-line lantern-i18n/no-hardcoded-string */}
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>Save a section as a template</div>
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            data-testid="clientmap-template-save-title"
            type="text"
            value={saveTitle}
            onChange={(e) => { setSaveTitle(e.target.value); }}
            placeholder="Template name (e.g. Settlement posture)"
            style={{ fontSize: 13, padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)' }}
          />
          <input
            data-testid="clientmap-template-save-prompt"
            type="text"
            value={savePrompt}
            onChange={(e) => { setSavePrompt(e.target.value); }}
            placeholder="What to track (optional, defaults to name)"
            style={{ fontSize: 13, padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 6, background: 'var(--color-surface)' }}
          />
          <Button
            type="submit"
            data-testid="clientmap-template-save"
            variant="secondary"
            size="sm"
            disabled={!saveTitle.trim()}
          >
            {LABEL_SAVE}
          </Button>
        </form>
      </div>
    </div>
  );
}
