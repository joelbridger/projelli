/**
 * Q8 — Templates category panel for the Settings modal.
 *
 * Renders a table of every known template (built-ins + any user templates)
 * and lets the user pin a provider+model override per template. Overrides
 * are persisted to `settingsStore` under the `templateModelOverrides` key.
 *
 * Leaving a row unset means "use the template's built-in default, or the
 * global default when the template doesn't specify one". See
 * `resolveTemplateModel` for the full precedence rules.
 */

import { useCallback, useMemo } from 'react';
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

interface TemplateModelSettingsProps {
  /** All templates to show (built-ins first, then user templates). */
  templates: WorkflowTemplate[];
}

/**
 * Provider -> list of model id/label pairs we offer in the dropdown.
 * Kept as an inline constant so this settings surface doesn't need to wait
 * for a live model-list fetch. Users with unusual models can always fall
 * back to the free-text "Other" option.
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

function firstModelFor(provider: TemplateProviderId): string {
  return PROVIDER_MODEL_OPTIONS[provider][0]?.value ?? '';
}

export function TemplateModelSettings({ templates }: TemplateModelSettingsProps) {
  const { t } = useTranslation();
  const { getSetting, setSetting } = useSettingsStore();

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
    [overrides, updateOverride]
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

  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        {t('settings.template-models.empty')}
      </p>
    );
  }

  return (
    <div data-testid="template-model-settings" className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t('settings.template-models.title')}</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {t('settings.template-models.description')}
        </p>
      </div>

      <div className="divide-y divide-border/50 rounded-md border">
        {templates.map((tpl) => {
          const override = overrides[tpl.id];
          const activeProvider: TemplateProviderId =
            override?.provider ?? tpl.defaultProvider ?? 'claude';
          const activeModel = override?.model ?? tpl.defaultModel ?? '';
          const modelOptions = PROVIDER_MODEL_OPTIONS[activeProvider];
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
                  {override
                    ? `Override: ${PROVIDER_LABEL[activeProvider]} - ${activeModel}`
                    : tpl.defaultProvider
                      ? `Template default: ${PROVIDER_LABEL[tpl.defaultProvider]} - ${tpl.defaultModel ?? ''}`
                      : 'Uses your global default'}
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
                  disabled={!override}
                  title={override ? 'Clear override' : 'No override set'}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default TemplateModelSettings;
