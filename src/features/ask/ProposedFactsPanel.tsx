import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Check, X, Pencil, Brain } from 'lucide-react';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';

/**
 * M3 — Proposed facts chip row. Rendered below the most recent AI
 * response whenever fact extraction returned candidates. Each chip has
 * Accept / Edit / Reject buttons; editing swaps the chip text for an
 * inline textarea with Save + Cancel.
 */
export interface ProposedFactsPanelProps {
  proposals: Array<{ key: string; text: string }>;
  onAccept: (key: string, editedText?: string) => void | Promise<void>;
  onReject: (key: string) => void;
}

export function ProposedFactsPanel({
  proposals,
  onAccept,
  onReject,
}: ProposedFactsPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const startEdit = (key: string, currentText: string) => {
    setEditingKey(key);
    setEditText(currentText);
  };
  const cancelEdit = () => {
    setEditingKey(null);
    setEditText('');
  };
  const saveEdit = async (key: string) => {
    await onAccept(key, editText);
    setEditingKey(null);
    setEditText('');
  };

  return (
    <div
      data-testid="proposed-facts-panel"
      className="mt-4 rounded-md border border-primary/30 bg-primary/5 p-3"
    >
      <button
        type="button"
        data-testid="proposed-facts-toggle"
        className="w-full flex items-center gap-2 text-xs font-medium text-primary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <Brain className="h-3.5 w-3.5" />
        {t('ai.chat.proposed-facts', { count: proposals.length })}
      </button>
      {expanded && (
        <ul className="mt-2 space-y-2">
          {proposals.map((p) => (
            <li
              key={p.key}
              data-testid={`proposed-fact-chip-${p.key}`}
              className="flex items-start gap-2 rounded border border-primary/20 bg-background px-3 py-2"
            >
              {editingKey === p.key ? (
                <>
                  <Textarea
                    data-testid={`fact-edit-input-${p.key}`}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="flex-1 min-h-[48px] text-sm"
                  />
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button
                      data-testid={`fact-edit-save-${p.key}`}
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        void saveEdit(p.key);
                      }}
                      disabled={editText.trim().length === 0}
                    >
                      Save
                    </Button>
                    <Button
                      data-testid={`fact-edit-cancel-${p.key}`}
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={cancelEdit}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm leading-relaxed">{p.text}</span>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      data-testid={`fact-accept-${p.key}`}
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/30"
                      onClick={() => {
                        void onAccept(p.key);
                      }}
                      aria-label="Accept fact"
                      title="Accept: save this fact to memory"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      data-testid={`fact-edit-${p.key}`}
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => startEdit(p.key, p.text)}
                      aria-label="Edit fact"
                      title="Edit before saving"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      data-testid={`fact-reject-${p.key}`}
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                      onClick={() => onReject(p.key)}
                      aria-label="Reject fact"
                      title="Reject: discard this proposal"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
