import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type MeetingIntelligenceSettingsProjection,
  type MeetingIntelligenceSettingsStore,
  type MeetingTemplateProjection,
  type MeetingTemplateStore,
  type MeetingTypeDefinition,
  type MeetingTypeStore,
  useMeetingIntelligenceSettingsStore,
  useMeetingTemplateStore,
  useMeetingTypeStore,
} from '@/features/meetings';
import { Button } from '@/ui/kp';

const ARTIFACT_KINDS = [
  'agenda',
  'pre-meeting-brief',
  'structured-notes',
  'summary',
  'transcript',
] as const;

type IntelligenceStores = {
  settings: MeetingIntelligenceSettingsStore;
  types: MeetingTypeStore;
  templates: MeetingTemplateStore;
};

function artifactLabel(
  t: (key: string) => string,
  kind: (typeof ARTIFACT_KINDS)[number]
) {
  switch (kind) {
    case 'agenda':
      return t('meeting-intelligence-settings.artifacts.agenda');
    case 'pre-meeting-brief':
      return t('meeting-intelligence-settings.artifacts.pre-meeting-brief');
    case 'structured-notes':
      return t('meeting-intelligence-settings.artifacts.structured-notes');
    case 'summary':
      return t('meeting-intelligence-settings.artifacts.summary');
    case 'transcript':
      return t('meeting-intelligence-settings.artifacts.transcript');
  }
}

function identifierFor(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function MeetingIntelligenceSettingsContent({
  stores,
}: {
  stores: IntelligenceStores;
}) {
  const { t } = useTranslation();
  const storesRef = useRef(stores);
  storesRef.current = stores;
  const [settings, setSettings] = useState<MeetingIntelligenceSettingsProjection>(
    stores.settings.settings
  );
  const [types, setTypes] = useState<readonly MeetingTypeDefinition[]>(
    stores.types.types
  );
  const [templates, setTemplates] = useState<
    readonly MeetingTemplateProjection[]
  >(stores.templates.templates);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [typeLabel, setTypeLabel] = useState('');
  const [templateLabel, setTemplateLabel] = useState('');
  const [templateKinds, setTemplateKinds] = useState<readonly (typeof ARTIFACT_KINDS)[number][]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const source = storesRef.current;
        const [nextSettings, nextTypes, nextTemplates] = await Promise.all([
          source.settings.get(),
          source.types.get(),
          source.templates.get(),
        ]);
        if (!active) return;
        setSettings(nextSettings);
        setTypes(nextTypes);
        setTemplates(nextTemplates);
      } catch {
        if (active) setError(t('meeting-intelligence-settings.errors.load'));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load().catch(() => {
      if (active) setError(t('meeting-intelligence-settings.errors.load'));
    });
    return () => {
      active = false;
    };
  }, [reloadKey, t]);

  const saveSettings = async (next: MeetingIntelligenceSettingsProjection) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await storesRef.current.settings.save(next);
      setSettings(saved);
    } catch {
      setError(t('meeting-intelligence-settings.errors.save'));
    } finally {
      setSaving(false);
    }
  };

  const addType = async () => {
    const label = typeLabel.trim();
    const id = identifierFor(label);
    if (!label || !id) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await storesRef.current.types.save([...types, { id, label }]);
      setTypes(saved);
      setTypeLabel('');
    } catch {
      setError(t('meeting-intelligence-settings.errors.catalog-save'));
    } finally {
      setSaving(false);
    }
  };

  const addTemplate = async () => {
    const label = templateLabel.trim();
    const id = identifierFor(label);
    if (!label || !id || templateKinds.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await storesRef.current.templates.save([
        ...templates,
        { id, label, artifactKinds: templateKinds },
      ]);
      setTemplates(saved);
      setTemplateLabel('');
      setTemplateKinds([]);
    } catch {
      setError(t('meeting-intelligence-settings.errors.catalog-save'));
    } finally {
      setSaving(false);
    }
  };

  const updateTemplateKind = (kind: (typeof ARTIFACT_KINDS)[number]) => {
    setTemplateKinds((current) =>
      current.includes(kind)
        ? current.filter((candidate) => candidate !== kind)
        : [...current, kind]
    );
  };

  return (
    <section
      aria-labelledby="meeting-intelligence-settings-heading"
      className="grid max-w-4xl gap-4"
      data-testid="meeting-intelligence-settings"
    >
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {t('meeting-intelligence-settings.eyebrow')}
        </p>
        <h2 className="mt-1 text-lg font-bold text-foreground" id="meeting-intelligence-settings-heading">
          {t('meeting-intelligence-settings.title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('meeting-intelligence-settings.description')}
        </p>
      </header>

      {loading ? (
        <p data-testid="meeting-intelligence-settings-loading" role="status">
          {t('meeting-intelligence-settings.loading')}
        </p>
      ) : null}
      {error ? (
        <div
          className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
          role="alert"
        >
          <span>{error}</span>
          <Button
            data-testid="meeting-intelligence-settings-retry"
            disabled={saving}
            onClick={() => {
              setReloadKey((value) => value + 1);
            }}
            size="sm"
            variant="secondary"
          >
            {t('meeting-intelligence-settings.retry')}
          </Button>
        </div>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h3 className="text-sm font-semibold">
          {t('meeting-intelligence-settings.preferences.title')}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('meeting-intelligence-settings.preferences.description')}
        </p>
        <div className="mt-4 divide-y divide-border">
          {([
            {
              key: 'keywordTrackingEnabled',
              label: t('meeting-intelligence-settings.preferences.keywords.label'),
              description: t('meeting-intelligence-settings.preferences.keywords.description'),
            },
            {
              key: 'clientSignalsEnabled',
              label: t('meeting-intelligence-settings.preferences.signals.label'),
              description: t('meeting-intelligence-settings.preferences.signals.description'),
            },
          ] as const).map(({ key, label, description }) => (
            <label className="flex items-center justify-between gap-4 py-3" key={key}>
              <span>
                <span className="block text-sm font-semibold">
                  {label}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {description}
                </span>
              </span>
              <input
                checked={settings[key]}
                data-testid={`meeting-intelligence-settings-${key}`}
                disabled={loading || saving}
                onChange={(event) => {
                  void saveSettings({ ...settings, [key]: event.target.checked }).catch(
                    () => {
                      setError(t('meeting-intelligence-settings.errors.save'));
                    }
                  );
                }}
                type="checkbox"
              />
            </label>
          ))}
        </div>
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold">
            {t('meeting-intelligence-settings.preferences.display.label')}
          </legend>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('meeting-intelligence-settings.preferences.display.description')}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {(['comfortable', 'compact'] as const).map((value) => (
              <label className="flex items-center gap-2 text-sm" key={value}>
                <input
                  checked={settings.displayPreference === value}
                  data-testid={`meeting-intelligence-settings-display-${value}`}
                  disabled={loading || saving}
                  name="meeting-intelligence-display"
                  onChange={() => {
                    void saveSettings({ ...settings, displayPreference: value }).catch(
                      () => {
                        setError(t('meeting-intelligence-settings.errors.save'));
                      }
                    );
                  }}
                  type="radio"
                  value={value}
                />
                {value === 'comfortable'
                  ? t('meeting-intelligence-settings.preferences.display.comfortable')
                  : t('meeting-intelligence-settings.preferences.display.compact')}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h3 className="text-sm font-semibold">
          {t('meeting-intelligence-settings.types.title')}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('meeting-intelligence-settings.types.description')}
        </p>
        {types.length === 0 && !loading ? (
          <p className="mt-3 rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            {t('meeting-intelligence-settings.types.empty')}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border" data-testid="meeting-intelligence-settings-types">
            {types.map((type) => (
              <li className="py-2 text-sm" key={type.id}>{type.label}</li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            aria-label={t('meeting-intelligence-settings.types.new-label')}
            className="min-w-48 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm"
            data-testid="meeting-intelligence-settings-new-type"
            disabled={saving}
            onChange={(event) => {
              setTypeLabel(event.target.value);
            }}
            value={typeLabel}
          />
          <Button
            data-testid="meeting-intelligence-settings-add-type"
            disabled={saving || !identifierFor(typeLabel)}
            onClick={() => {
              void addType().catch(() => {
                setError(t('meeting-intelligence-settings.errors.catalog-save'));
              });
            }}
            size="sm"
            variant="secondary"
          >
            {t('meeting-intelligence-settings.types.add')}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h3 className="text-sm font-semibold">
          {t('meeting-intelligence-settings.templates.title')}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('meeting-intelligence-settings.templates.description')}
        </p>
        {templates.length === 0 && !loading ? (
          <p className="mt-3 rounded-lg border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            {t('meeting-intelligence-settings.templates.empty')}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border" data-testid="meeting-intelligence-settings-templates">
            {templates.map((template) => (
              <li className="py-2 text-sm" key={template.id}>
                <span className="font-semibold">{template.label}</span>
                <span className="ml-2 text-muted-foreground">
                  {template.artifactKinds.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 grid gap-3">
          <input
            aria-label={t('meeting-intelligence-settings.templates.new-label')}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
            data-testid="meeting-intelligence-settings-new-template"
            disabled={saving}
            onChange={(event) => {
              setTemplateLabel(event.target.value);
            }}
            value={templateLabel}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {ARTIFACT_KINDS.map((kind) => (
              <label className="flex items-center gap-2 text-sm" key={kind}>
                <input
                  checked={templateKinds.includes(kind)}
                  disabled={saving}
                  onChange={() => {
                    updateTemplateKind(kind);
                  }}
                  type="checkbox"
                />
                {artifactLabel(t, kind)}
              </label>
            ))}
          </div>
          <div>
            <Button
              data-testid="meeting-intelligence-settings-add-template"
              disabled={saving || !identifierFor(templateLabel) || templateKinds.length === 0}
              onClick={() => {
                void addTemplate().catch(() => {
                  setError(t('meeting-intelligence-settings.errors.catalog-save'));
                });
              }}
              size="sm"
              variant="secondary"
            >
              {saving
                ? t('meeting-intelligence-settings.saving')
                : t('meeting-intelligence-settings.templates.add')}
            </Button>
          </div>
        </div>
      </section>
    </section>
  );
}

/** Settings mount: records are read only after the registry's outer flag gate. */
export function MeetingIntelligenceSettingsPanel() {
  const settings = useMeetingIntelligenceSettingsStore();
  const types = useMeetingTypeStore();
  const templates = useMeetingTemplateStore();
  return <MeetingIntelligenceSettingsContent stores={{ settings, types, templates }} />;
}

export { MeetingIntelligenceSettingsContent };
export type { IntelligenceStores };
