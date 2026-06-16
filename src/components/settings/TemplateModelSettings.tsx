/**
 * Q8 — Templates category panel for the Settings modal.
 *
 * Compact redesign: shows only templates that currently HAVE an override set.
 * A single "add" dropdown lets users pin any un-overridden template.
 * Leaving a template unset means "use the template's built-in default, or the
 * global default when the template doesn't specify one". See
 * `resolveTemplateModel` for the full precedence rules.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import type { WorkflowTemplate, TemplateProviderId } from '@/types/workflow';
import {
  TEMPLATE_MODEL_OVERRIDES_KEY,
  type TemplateModelOverride,
} from '@/modules/workflow/resolveTemplateModel';
import {
  detectOllama,
  formatOllamaDisplayName,
} from '@/modules/models/OllamaProvider';

interface TemplateModelSettingsProps {
  /** All templates to show (built-ins first, then user templates). */
  templates: WorkflowTemplate[];
}

/**
 * Provider -> static fallback list of model id/label pairs for the dropdown.
 * Cloud providers use these as-is so this settings surface never waits on a
 * live model-list fetch. The Ollama entry is only the fallback: when the
 * local daemon is reachable, the dropdown is replaced by the tags actually
 * installed on this machine (detectOllama — F-502 sub-finding).
 */
const PROVIDER_MODEL_OPTIONS: Record<
  TemplateProviderId,
  { value: string; label: string }[]
> = {
  claude: [
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  ],
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { value: 'o1-preview', label: 'o1-preview' },
  ],
  gemini: [
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ],
  ollama: [
    { value: 'llama3.1:8b', label: 'Llama 3.1 (8B)' },
    { value: 'qwen2.5:7b', label: 'Qwen 2.5 (7B)' },
  ],
};

const PROVIDER_LABEL: Record<TemplateProviderId, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  ollama: 'Ollama',
};

export function TemplateModelSettings({ templates }: TemplateModelSettingsProps) {
  const { t } = useTranslation();
  const { getSetting, setSetting } = useSettingsStore();

  // F-502 sub-finding — the Ollama dropdown now reflects what is actually
  // installed (detectOllama, same source as the chat picker) instead of a
  // hardcoded pair that may not exist on this machine. Falls back to the
  // static pair when the daemon is unreachable so the control stays usable.
  const [liveOllamaModels, setLiveOllamaModels] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void detectOllama().then((res) => {
      if (!cancelled && res.reachable) setLiveOllamaModels(res.models);
    });
    return () => { cancelled = true; };
  }, []);

  const modelOptionsFor = useCallback(
    (provider: TemplateProviderId): { value: string; label: string }[] =>
      provider === 'ollama' && liveOllamaModels.length > 0
        ? liveOllamaModels.map((m) => ({
            value: m,
            label: formatOllamaDisplayName(m),
          }))
        : PROVIDER_MODEL_OPTIONS[provider],
    [liveOllamaModels]
  );

  // First entry of the LIVE list for ollama (static fallback otherwise) so a
  // provider switch seeds an installed model, consistent with the dropdown.
  const firstModelFor = useCallback(
    (provider: TemplateProviderId): string =>
      modelOptionsFor(provider)[0]?.value ?? '',
    [modelOptionsFor]
  );

  const overrides = useMemo(
    () =>
      (getSetting<Record<string, TemplateModelOverride> | undefined>(
        TEMPLATE_MODEL_OVERRIDES_KEY
      ) ?? {}),
    [getSetting]
  );

  const updateOverride = useCallback(
    (templateId: string, next: TemplateModelOverride | undefined) => {
      const current =
        (getSetting<Record<string, TemplateModelOverride> | undefined>(
          TEMPLATE_MODEL_OVERRIDES_KEY
        ) ?? {});
      const updated: Record<string, TemplateModelOverride> = { ...current };
      if (next) {
        updated[templateId] = next;
      } else {
        delete updated[templateId];
      }
      setSetting(TEMPLATE_MODEL_OVERRIDES_KEY, updated);
    },
    [getSetting, setSetting]
  );

  const handleProviderChange = useCallback(
    (templateId: string, provider: TemplateProviderId) => {
      const existing = overrides[templateId];
      if (!existing || existing.provider !== provider) {
        updateOverride(templateId, {
          provider,
          model: firstModelFor(provider),
        });
      }
    },
    [overrides, updateOverride, firstModelFor]
  );

  const handleModelChange = useCallback(
    (templateId: string, model: string) => {
      const existing = overrides[templateId];
      const provider: TemplateProviderId = existing?.provider ?? 'claude';
      updateOverride(templateId, { provider, model });
    },
    [overrides, updateOverride]
  );

  const handleClear = useCallback(
    (templateId: string) => {
      updateOverride(templateId, undefined);
    },
    [updateOverride]
  );

  // Templates that currently have an override — the visible rows.
  const pinnedTemplates = useMemo(
    () => templates.filter((tpl) => overrides[tpl.id] !== undefined),
    [templates, overrides]
  );

  // Templates that do NOT yet have an override — candidates for the add dropdown.
  const unpinnedTemplates = useMemo(
    () => templates.filter((tpl) => overrides[tpl.id] === undefined),
    [templates, overrides]
  );

  // Seed a new override when the user picks a template from the add dropdown.
  const handleAddTemplate = useCallback(
    (templateId: string) => {
      if (!templateId) return;
      const tpl = templates.find((t) => t.id === templateId);
      if (!tpl) return;
      const provider: TemplateProviderId = tpl.defaultProvider ?? 'claude';
      updateOverride(templateId, {
        provider,
        model: tpl.defaultModel ?? firstModelFor(provider),
      });
    },
    [templates, updateOverride, firstModelFor]
  );

  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        {t('settings.template-models.empty')}
      </p>
    );
  }

  return (
    <div data-testid="template-model-settings" className="space-y-3">
      {/* Pinned override rows — only shown when at least one override exists */}
      {pinnedTemplates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
          Your workflows use your default AI. Pin a specific model to any workflow below.
        </p>
      ) : (
        <div className="divide-y divide-border/50 rounded-md border">
          {pinnedTemplates.map((tpl) => {
            const override = overrides[tpl.id];
            // override is guaranteed to exist here; satisfy noUncheckedIndexedAccess
            const activeProvider: TemplateProviderId =
              override?.provider ?? tpl.defaultProvider ?? 'claude';
            const activeModel = override?.model ?? tpl.defaultModel ?? '';
            const modelOptions = modelOptionsFor(activeProvider);
            return (
              <div
                key={tpl.id}
                data-testid={`settings-template-model-row-${tpl.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-sm font-medium truncate">
                      {tpl.name}
                    </Label>
                    {tpl.isUser && (
                      <span
                        data-testid={`settings-template-user-badge-${tpl.id}`}
                        className="text-[10px] font-medium uppercase tracking-wide bg-primary/10 text-primary px-1.5 py-0.5 rounded"
                      >
                        Custom
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {`Override: ${PROVIDER_LABEL[activeProvider]} - ${activeModel}`}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <select
                    data-testid={`settings-template-provider-${tpl.id}`}
                    value={activeProvider}
                    onChange={(e) =>
                      handleProviderChange(
                        tpl.id,
                        e.target.value as TemplateProviderId
                      )
                    }
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    {(Object.keys(PROVIDER_LABEL) as TemplateProviderId[]).map(
                      (p) => (
                        <option key={p} value={p}>
                          {PROVIDER_LABEL[p]}
                        </option>
                      )
                    )}
                  </select>
                  <select
                    data-testid={`settings-template-model-${tpl.id}`}
                    value={activeModel || modelOptions[0]?.value || ''}
                    onChange={(e) => handleModelChange(tpl.id, e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs min-w-[140px]"
                  >
                    {modelOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    data-testid={`settings-template-clear-${tpl.id}`}
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => handleClear(tpl.id)}
                    aria-label={`Clear override for ${tpl.name}`}
                    title="Remove pin — workflow will use your default AI"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add dropdown — only shown when there are still templates to pin */}
      {unpinnedTemplates.length > 0 && (
        <select
          data-testid="template-model-add"
          value=""
          onChange={(e) => {
            handleAddTemplate(e.target.value);
            // Reset the select back to placeholder after selection
            e.target.value = '';
          }}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-muted-foreground"
        >
          {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
          <option value="" disabled>
            Pin a model to a workflow...
          </option>
          {unpinnedTemplates.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export default TemplateModelSettings;
