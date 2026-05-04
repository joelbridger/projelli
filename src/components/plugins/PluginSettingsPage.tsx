// Plugin runner — renders one plugin's settings page from its schema.
//
// Each plugin contributes a `SettingsPageSpec` with a schema describing the
// fields the user can edit. We render every field as a primitive control
// (toggle, text, number, select). Values flow through `SettingsHost` via
// `api.settings.get/set` so the plugin sees them at the same key inside
// the worker.
//
// Storage scope: per-plugin. The host namespaces by plugin id so two plugins
// can use the same setting key without collision.
//
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 8.4)

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { RegisteredSettingsPage } from '@/stores/pluginRegistryStore';
import type { SettingsPageFieldSpec } from '@/types/plugin';

interface PluginSettingsPageProps {
  page: RegisteredSettingsPage;
}

const STORAGE_PREFIX = 'projelli:plugin';

function settingStorageKey(pluginId: string, key: string): string {
  return `${STORAGE_PREFIX}:${pluginId}:settings:${key}`;
}

function readSettingValue(
  pluginId: string,
  key: string,
  fieldSpec: SettingsPageFieldSpec,
): string | number | boolean {
  if (typeof localStorage === 'undefined') return fieldSpec.default;
  const raw = localStorage.getItem(settingStorageKey(pluginId, key));
  if (raw === null) return fieldSpec.default;
  try {
    return JSON.parse(raw) as string | number | boolean;
  } catch {
    return fieldSpec.default;
  }
}

function writeSettingValue(
  pluginId: string,
  key: string,
  value: string | number | boolean,
): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(settingStorageKey(pluginId, key), JSON.stringify(value));
}

export function PluginSettingsPage({ page }: PluginSettingsPageProps) {
  const { t } = useTranslation();
  const entries = Object.entries(page.schema);
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => {
    const initial: Record<string, string | number | boolean> = {};
    for (const [key, fieldSpec] of entries) {
      initial[key] = readSettingValue(page.pluginId, key, fieldSpec);
    }
    return initial;
  });

  // Re-read whenever the page changes (e.g. user navigated to another plugin
  // settings page and back). Cheap because the entries list is short.
  useEffect(() => {
    const next: Record<string, string | number | boolean> = {};
    for (const [key, fieldSpec] of entries) {
      next[key] = readSettingValue(page.pluginId, key, fieldSpec);
    }
    setValues(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, page.pluginId]);

  const updateValue = useCallback(
    (key: string, value: string | number | boolean) => {
      setValues((prev) => ({ ...prev, [key]: value }));
      writeSettingValue(page.pluginId, key, value);
    },
    [page.pluginId],
  );

  return (
    <div
      data-testid="plugin-settings-page"
      data-page-id={page.id}
      data-plugin-id={page.pluginId}
      className="space-y-4"
    >
      <div className="border-b pb-3">
        <h3 className="text-base font-semibold">{page.title}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t('plugins.settings-page.contributed-by', { pluginId: page.pluginId })}
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('plugins.settings-page.no-settings')}
        </p>
      ) : (
        entries.map(([key, fieldSpec]) => (
          <PluginSettingRow
            key={key}
            settingKey={key}
            fieldSpec={fieldSpec}
            value={values[key] ?? fieldSpec.default}
            onChange={(v) => updateValue(key, v)}
          />
        ))
      )}
    </div>
  );
}

interface PluginSettingRowProps {
  settingKey: string;
  fieldSpec: SettingsPageFieldSpec;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
}

function PluginSettingRow({
  settingKey,
  fieldSpec,
  value,
  onChange,
}: PluginSettingRowProps) {
  const controlId = `plugin-setting-${settingKey}`;
  let control: React.ReactNode;
  switch (fieldSpec.type) {
    case 'boolean':
      control = (
        <button
          id={controlId}
          type="button"
          role="switch"
          aria-checked={Boolean(value)}
          onClick={() => onChange(!value)}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors',
            value ? 'bg-primary' : 'bg-muted',
          )}
          data-testid={`plugin-setting-control-${settingKey}`}
        >
          <span
            className={cn(
              'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
              value ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      );
      break;
    case 'number':
      control = (
        <Input
          id={controlId}
          type="number"
          value={Number(value)}
          onChange={(e) => {
            const parsed = Number(e.target.value);
            if (!Number.isNaN(parsed)) onChange(parsed);
          }}
          className="w-32 h-8 text-sm"
          data-testid={`plugin-setting-control-${settingKey}`}
        />
      );
      break;
    case 'select':
      control = (
        <select
          id={controlId}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-3 text-sm"
          data-testid={`plugin-setting-control-${settingKey}`}
        >
          {(fieldSpec.choices ?? []).map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      );
      break;
    case 'string':
    default:
      control = (
        <Input
          id={controlId}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="max-w-[260px] h-8 text-sm"
          data-testid={`plugin-setting-control-${settingKey}`}
        />
      );
      break;
  }

  return (
    <div
      data-testid={`plugin-setting-row-${settingKey}`}
      className="flex items-center justify-between py-2 border-b border-border/50 last:border-b-0"
    >
      <Label htmlFor={controlId} className="text-sm font-medium cursor-pointer flex-1 mr-4">
        {fieldSpec.label}
      </Label>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export default PluginSettingsPage;
