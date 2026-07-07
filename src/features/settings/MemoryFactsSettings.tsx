/**
 * MemoryFactsSettings — the "Memory Facts" table rendered inside the
 * Settings modal's Memory category (M3).
 *
 * What it shows:
 *   - A table of every fact currently saved under
 *     `<workspace>/.lantern/memory.json`, newest first.
 *   - A trash button per row to delete a fact.
 *   - A one-line "Add fact manually" input with a Save button.
 *
 * What it intentionally does NOT show:
 *   - Fact provenance (which chat / which message). That metadata is
 *     stored but hidden from the table UI to keep the table scannable;
 *     it still lives in the JSON file for advanced users who open it.
 *   - Edit-in-place. Delete-and-re-add is simpler and the facts are
 *     short plain-language sentences — 1-2 clicks either way.
 *
 * The component pulls its service from the factsSingleton so it works
 * regardless of which workspace is open; if no workspace is open it
 * renders an empty-state message.
 */

import { useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Trash2, Plus } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { InfoHelp } from '@/ui/InfoHelp';
import { getFactsService } from '@/platform/rag/factsSingleton';
import type { Fact } from '@/platform/rag/FactsService';

export interface MemoryFactsSettingsProps {
  /** Optional override for tests — passes in a static fact list so
   *  the row renderer can be asserted without mocking the singleton. */
  initialFacts?: Fact[];
  /** Optional override — invoked instead of the singleton when the
   *  user presses Delete. Tests use this to spy without a real
   *  FactsService. */
  onDelete?: (id: string) => Promise<boolean | void>;
  /** Optional override — invoked instead of the singleton when the
   *  user adds a fact manually. */
  onAdd?: (text: string) => Promise<Fact | void>;
}

export function MemoryFactsSettings({
  initialFacts,
  onDelete,
  onAdd,
}: MemoryFactsSettingsProps): React.ReactElement {
  const { t } = useTranslation();
  const [facts, setFacts] = useState<Fact[]>(initialFacts ?? []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newFactText, setNewFactText] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (initialFacts !== undefined) {
      setFacts(initialFacts);
      return;
    }
    const svc = getFactsService();
    if (!svc) {
      setFacts([]);
      return;
    }
    try {
      const current = await svc.listFacts();
      // QA-58 (cross-workspace isolation): listFacts is async. If the workspace
      // switched while we awaited (the singleton now points at a DIFFERENT
      // service), drop this stale result — never render workspace A's memory
      // facts inside workspace B's settings.
      if (getFactsService() !== svc) return;
      // Newest first — the JSON stores append-order, so reverse.
      setFacts([...current].reverse());
      setLoadError(null);
    } catch (err) {
      if (getFactsService() !== svc) return;
      setLoadError(err instanceof Error ? err.message : 'Failed to load facts');
    }
  }, [initialFacts]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (onDelete) {
        await onDelete(id);
      } else {
        const svc = getFactsService();
        if (!svc) return;
        await svc.deleteFact(id);
      }
      await refresh();
    },
    [onDelete, refresh],
  );

  const handleAdd = useCallback(async () => {
    const trimmed = newFactText.trim();
    if (trimmed.length === 0 || saving) return;
    setSaving(true);
    try {
      if (onAdd) {
        await onAdd(trimmed);
      } else {
        const svc = getFactsService();
        if (!svc) return;
        await svc.addFact({ text: trimmed, approved_by: 'user' });
      }
      setNewFactText('');
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [newFactText, saving, onAdd, refresh]);

  return (
    <div
      data-testid="settings-facts-section"
      className="mt-6 pt-4 border-t border-border/50"
    >
      <div className="mb-3 flex items-center gap-1.5">
        <h3 className="text-sm font-medium">
          {t('settings.memory-facts.title')}
        </h3>
        <InfoHelp
          label={`About ${t('settings.memory-facts.title')}`}
          content={
            <Trans
              i18nKey="settings.memory-facts.description"
              components={{
                c: <code className="mx-1 px-1 py-0.5 rounded bg-muted font-mono text-[11px]" />,
              }}
            />
          }
        />
      </div>

      {loadError && (
        <div
          data-testid="settings-facts-load-error"
          className="mb-2 text-xs text-destructive"
        >
          {t('settings.memory-facts.load-error', { error: loadError })}
        </div>
      )}

      <div
        data-testid="settings-facts-table"
        className="mb-3 rounded-md border border-border/60"
      >
        {facts.length === 0 ? (
          <div
            data-testid="settings-facts-empty"
            className="px-3 py-4 text-xs text-muted-foreground text-center"
          >
            {t('settings.memory-facts.empty')}
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {facts.map((fact) => (
              <li
                key={fact.id}
                data-testid={`settings-facts-row-${fact.id}`}
                className="flex items-start gap-2 px-3 py-2"
              >
                <span className="flex-1 text-sm leading-relaxed">
                  {fact.text}
                </span>
                <Button
                  data-testid={`settings-facts-delete-${fact.id}`}
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    void handleDelete(fact.id);
                  }}
                  aria-label={t('settings.memory-facts.delete-aria')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Input
          data-testid="settings-facts-add-input"
          value={newFactText}
          onChange={(e) => setNewFactText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleAdd();
            }
          }}
          placeholder={t('settings.memory-facts.add-placeholder')}
          className="h-8 text-sm"
        />
        <Button
          data-testid="settings-facts-add"
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs shrink-0"
          onClick={() => {
            void handleAdd();
          }}
          disabled={newFactText.trim().length === 0 || saving}
        >
          <Plus className="h-3 w-3" />
          {t('common.actions.add')}
        </Button>
      </div>
    </div>
  );
}

export default MemoryFactsSettings;
