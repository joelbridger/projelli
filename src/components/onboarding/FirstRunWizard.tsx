/**
 * FirstRunWizard — onboarding wizard shown to new users on their first launch.
 *
 * Walks the user through:
 *   1. Welcome / value prop
 *   2. What kind of work do you do (profession) — also sets a sensible default model
 *   3. Pick a workspace location
 *   4. Where your data goes (plain-English data map) — the trust story, told
 *      BEFORE the AI step so the user understands it around connecting a key
 *   5. Connect an AI (the rebuilt core step): plain English first, then three
 *      clear paths (use your own account / keep it on your computer / set up
 *      later). Never dead-ends; skip is always available.
 *   6. (Optional) Run a sample workflow to see the magic moment
 *   7. Done — drop them into the workspace
 *
 * Triggered when:
 *   - The app launches with no recent workspaces (`workspaceStore.recentWorkspaces.length === 0`)
 *   - AND no `keepance_onboarding_complete` flag in localStorage
 *
 * Sets `keepance_onboarding_complete = "true"` after the user finishes (or skips).
 *
 * Designed to be embedded inside the existing WorkspaceSelector flow rather
 * than replacing it — we want to honor the existing path-input vs file-picker
 * logic for browser vs Tauri modes.
 *
 * TODO (later, out of scope here): a guided "wedge" demo that, on first run,
 * lands the user on connect-email-then-ask-a-cited-question. The clean hook for
 * it is the `onComplete` callback below: a future build can branch into the
 * wedge flow there instead of dropping straight into the workspace.
 */

import { useState, type ReactNode } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { writeSampleFiles, getSamplesForProfession } from '@/onboarding/samples';
import { AiSetupStep } from '@/components/onboarding/AiSetupStep';
import { DataMapDialog, DataMapContent } from '@/components/privacy/DataMapDialog';
import { persistProfessionModelDefault, getModelForProfession } from '@/onboarding/professionModel';
import { markAiSetupDeferred } from '@/onboarding/aiSetupState';
import type { KeyProvider } from '@/modules/models/KeychainService';
import type { ProviderId } from '@/components/onboarding/ProviderTutorialSteps';

const STORAGE_KEY = 'keepance_onboarding_complete';
const PROFESSION_STORAGE_KEY = 'keepance_profession';

/**
 * Minimal slice of `WorkspaceService` that the wizard needs. Typed as a
 * duck-typed interface so tests can pass a mock without importing the real
 * service (which pulls in filesystem backends).
 */
export interface WizardWorkspace {
  writeFile: (path: string, content: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
}

export interface FirstRunWizardProps {
  /** Called when the user completes the wizard. */
  onComplete: () => void;
  /** Called when the user picks "Skip" — doesn't mark onboarding as complete. */
  onSkip: () => void;
  /**
   * Optional workspace handle used to populate sample files when the
   * "Populate workspace with samples" toggle is on. When omitted, the toggle
   * still renders but has no effect at finish — useful for tests and browsers
   * without a workspace root selected yet.
   */
  workspace?: WizardWorkspace;
  /**
   * Persist a connected cloud API key. Should route into the same save path
   * Settings uses (KeychainService.setKey). When omitted, the AI-setup step
   * still renders and behaves, but the key is only validated, not persisted
   * (useful for tests/browsers without a keychain).
   */
  onSaveApiKey?: (provider: KeyProvider, key: string) => void | Promise<void>;
}

type Step = 'welcome' | 'profession' | 'workspace' | 'data' | 'ai-setup' | 'demo' | 'done';

type Profession = 'legal' | 'tax' | 'consulting' | 'advisor' | 'other';

interface ProfessionOption {
  id: Profession;
  heading: string;
  description: string;
}

const PROFESSION_OPTIONS: ProfessionOption[] = [
  {
    id: 'legal',
    heading: 'Legal practice',
    description: 'Attorneys, paralegals, and legal professionals. Comes with the Legal Practice template pack.',
  },
  {
    id: 'tax',
    heading: 'Tax & accounting',
    description: 'CPAs, EAs, tax preparers, and bookkeepers. Comes with the Tax Practice template pack.',
  },
  {
    id: 'consulting',
    heading: 'Consulting & strategy',
    description: 'Independent consultants, fractional executives, and agency owners. Comes with the Consulting Practice template pack.',
  },
  {
    id: 'other',
    heading: 'Something else',
    description: 'Writers, researchers, designers, and everyone else. Starts with the general templates.',
  },
];

export function FirstRunWizard({ onComplete, onSkip, workspace, onSaveApiKey }: FirstRunWizardProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('welcome');
  const [profession, setProfession] = useState<Profession | null>(null);
  // Q11 (Wave 1.5): default ON — new users benefit from seeing realistic
  // artifacts before they run their first workflow.
  const [populateSamples, setPopulateSamples] = useState(true);
  const [isFinishing, setIsFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  // Always-available "Where does my data go?" map, reachable from the AI step
  // and the dedicated data step.
  const [dataMapOpen, setDataMapOpen] = useState(false);

  // Default AI provider for the "use your own account" flow, derived from the
  // chosen profession. Every profession we ship defaults to Claude (Anthropic).
  const defaultProvider: ProviderId =
    (getModelForProfession(profession).provider as ProviderId) ?? 'anthropic';

  /** Select a profession and lock in its sensible default model. */
  const selectProfession = (id: Profession) => {
    setProfession(id);
    // Set a sensible default model for the chosen profession (e.g. legal -> a
    // strong Claude default). Never overrides a model the user already picked.
    persistProfessionModelDefault(id);
  };

  const markComplete = async () => {
    setFinishError(null);
    if (populateSamples && workspace) {
      setIsFinishing(true);
      try {
        await writeSampleFiles(workspace, profession ?? 'other');
      } catch (err) {
        // Don't block onboarding completion on a failed sample copy — log the
        // error and let the user into the app. Samples are a nice-to-have.
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[FirstRunWizard] failed to populate samples:', message);
        setFinishError(message);
      } finally {
        setIsFinishing(false);
      }
    }
    // Store profession selection for template pre-installation (template registry
    // wiring is handled separately). Default to 'other' if the user skipped.
    localStorage.setItem(PROFESSION_STORAGE_KEY, profession ?? 'other');
    // Make sure the profession's default model is recorded even if the user
    // skipped quickly. Never overrides an already-chosen model.
    persistProfessionModelDefault(profession ?? 'other');
    localStorage.setItem(STORAGE_KEY, 'true');
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl">
        {/* Progress indicator */}
        <div className="flex items-center justify-between px-8 pt-6">
          <div className="flex gap-2">
            {(['welcome', 'profession', 'workspace', 'data', 'ai-setup', 'demo'] as Step[]).map((s) => {
              const order: Step[] = ['welcome', 'profession', 'workspace', 'data', 'ai-setup', 'demo', 'done'];
              const currentIdx = order.indexOf(step);
              const stepIdx = order.indexOf(s);
              return (
                <div
                  key={s}
                  className={`h-1 w-12 rounded-full transition-colors ${
                    stepIdx <= currentIdx ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              );
            })}
          </div>
          <button
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('onboarding.first-run.skip-for-now')}
          </button>
        </div>

        <div className="px-8 py-8">
          {step === 'welcome' && (
            <Pane
              title={t('onboarding.first-run.welcome.title')}
              subtitle={t('onboarding.first-run.welcome.subtitle')}
              body={
                <div className="space-y-4 text-sm text-muted-foreground">
                  <p>
                    {t('onboarding.first-run.welcome.body-1')}
                  </p>
                  <p>
                    {t('onboarding.first-run.welcome.body-2')}
                  </p>
                  <ul className="space-y-2 mt-4 text-xs">
                    <li>{t('onboarding.first-run.welcome.step-1')}</li>
                    <li>{t('onboarding.first-run.welcome.step-2')}</li>
                    <li>{t('onboarding.first-run.welcome.step-3')}</li>
                  </ul>
                </div>
              }
              actions={
                <Button data-testid="onboarding-next" onClick={() => setStep('profession')} size="lg">
                  {t('onboarding.first-run.welcome.cta')}
                </Button>
              }
            />
          )}

          {step === 'profession' && (
            <Pane
              title="What kind of work do you do?"
              subtitle="We'll set up your workspace with the right starting templates."
              body={
                <div className="grid grid-cols-2 gap-3">
                  {PROFESSION_OPTIONS.map((option) => {
                    const isSelected = profession === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        data-testid={`profession-card-${option.id}`}
                        onClick={() => selectProfession(option.id)}
                        className={`rounded-lg border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          isSelected
                            ? 'bg-primary/10 border-primary'
                            : 'border-border hover:bg-muted/30'
                        }`}
                      >
                        <p className="text-sm font-semibold text-foreground">{option.heading}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
                      </button>
                    );
                  })}
                </div>
              }
              actions={
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep('welcome')}>
                    {t('onboarding.first-run.back')}
                  </Button>
                  <Button data-testid="onboarding-next" onClick={() => setStep('workspace')} size="lg">
                    {profession
                      ? t('onboarding.first-run.workspace.cta')
                      : t('onboarding.first-run.skip-for-now')}
                  </Button>
                </div>
              }
            />
          )}

          {step === 'workspace' && (
            <Pane
              title={t('onboarding.first-run.workspace.title')}
              subtitle={t('onboarding.first-run.workspace.subtitle')}
              body={
                <div className="space-y-4 text-sm text-muted-foreground">
                  <p>
                    {t('onboarding.first-run.workspace.body-1')}
                  </p>
                  <p>
                    <Trans
                      i18nKey="onboarding.first-run.workspace.body-2"
                      components={{ s: <strong className="text-foreground" /> }}
                    />
                  </p>
                  <div className="rounded-lg border border-border bg-muted/30 p-4">
                    <p className="text-xs font-medium text-foreground mb-2">{t('onboarding.first-run.workspace.common-choices')}</p>
                    <ul className="text-xs space-y-1 font-mono">
                      <li>~/Documents/Keepance</li>
                      <li>~/Dropbox/Keepance</li>
                      <li>{t('onboarding.first-run.workspace.icloud-path')}</li>
                    </ul>
                  </div>
                  <p className="text-xs">
                    {t('onboarding.first-run.workspace.body-3')}
                  </p>
                </div>
              }
              actions={
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep('profession')}>
                    {t('onboarding.first-run.back')}
                  </Button>
                  <Button data-testid="onboarding-workspace-next" onClick={() => setStep('data')} size="lg">
                    {t('onboarding.first-run.workspace.cta')}
                  </Button>
                </div>
              }
            />
          )}

          {/* Data step: the user finishes onboarding able to explain where their
              data lives. Reuses the exact, legally-precise DataMapContent.
              The body is scrollable so the footer (continue button) is always
              reachable at common window heights (1366x720+). */}
          {step === 'data' && (
            <PaneScrollable
              title="Where your data goes"
              subtitle="Before we connect an AI, here is the whole picture in plain language."
              body={
                <div data-testid="onboarding-data-step">
                  <DataMapContent variant="accordion" />
                </div>
              }
              actions={
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep('workspace')}>
                    {t('onboarding.first-run.back')}
                  </Button>
                  <Button
                    data-testid="onboarding-data-continue"
                    onClick={() => setStep('ai-setup')}
                    size="lg"
                  >
                    {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
                    Got it, connect an AI
                  </Button>
                </div>
              }
            />
          )}

          {/* AI-setup step: the core fix. Plain English, then three paths,
              never dead-ends (skip is always available). */}
          {step === 'ai-setup' && (
            <AiSetupStep
              defaultProvider={defaultProvider}
              onBack={() => setStep('data')}
              onOpenDataMap={() => setDataMapOpen(true)}
              onSaveKey={async (provider, key) => {
                if (onSaveApiKey) {
                  await onSaveApiKey(provider, key);
                }
                setStep('demo');
              }}
              onUseLocal={() => setStep('demo')}
              onSkip={() => {
                // A genuine, no-shame skip: set the reminder flag and move on.
                // Onboarding is never blocked on the key.
                markAiSetupDeferred();
                setStep('demo');
              }}
            />
          )}

          {step === 'demo' && (
            <Pane
              title={t('onboarding.first-run.demo.title')}
              subtitle={t('onboarding.first-run.demo.subtitle')}
              body={
                <div className="space-y-4 text-sm text-muted-foreground">
                  <p>
                    <Trans
                      i18nKey="onboarding.first-run.demo.body-1"
                      components={{ s: <strong className="text-foreground" /> }}
                    />
                  </p>
                  <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary font-semibold leading-none text-primary-foreground">
                        1
                      </span>
                      <Trans
                        i18nKey="onboarding.first-run.demo.step-1"
                        components={{ s: <strong className="text-foreground" /> }}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary font-semibold leading-none text-primary-foreground">
                        2
                      </span>
                      <Trans
                        i18nKey="onboarding.first-run.demo.step-2"
                        components={{ s: <strong className="text-foreground" /> }}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary font-semibold leading-none text-primary-foreground">
                        3
                      </span>
                      <Trans
                        i18nKey="onboarding.first-run.demo.step-3"
                        components={{ s: <strong className="text-foreground" /> }}
                      />
                    </div>
                  </div>
                  <p className="text-xs">
                    {t('onboarding.first-run.demo.outcome')}
                  </p>

                  {/* Q11 (Wave 1.5): sample-files toggle. */}
                  <label className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-4 cursor-pointer hover:bg-muted/30 transition-colors">
                    <input
                      data-testid="first-run-samples-toggle"
                      type="checkbox"
                      checked={populateSamples}
                      onChange={(e) => setPopulateSamples(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-primary"
                    />
                    <div className="flex-1 text-xs">
                      <div className="font-medium text-foreground">
                        {t('onboarding.first-run.demo.populate-toggle', { count: getSamplesForProfession(profession ?? 'other').length })}
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {t('onboarding.first-run.demo.populate-help')}
                      </p>
                    </div>
                  </label>

                  {finishError && (
                    <p className="text-xs text-destructive">
                      {t('onboarding.first-run.demo.copy-error', { error: finishError })}
                    </p>
                  )}
                </div>
              }
              actions={
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep('ai-setup')} disabled={isFinishing}>
                    {t('onboarding.first-run.back')}
                  </Button>
                  <Button onClick={markComplete} size="lg" disabled={isFinishing}>
                    {isFinishing ? t('onboarding.first-run.demo.setting-up') : t('onboarding.first-run.demo.open-cta')}
                  </Button>
                </div>
              }
            />
          )}
        </div>
      </div>

      {/* Always-available "Where does my data go?" map, opened from the AI step. */}
      <DataMapDialog open={dataMapOpen} onOpenChange={setDataMapOpen} />
    </div>
  );
}

interface PaneProps {
  title: string;
  subtitle?: string;
  body: ReactNode;
  actions: ReactNode;
}

function Pane({ title, subtitle, body, actions }: PaneProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
        {subtitle && <p className="text-base text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      <div>{body}</div>
      <div className="flex justify-end pt-4 border-t border-border">{actions}</div>
    </div>
  );
}

/**
 * PaneScrollable — variant of Pane where the body area is flex-scroll-bounded
 * so the footer (actions) is always visible without page scrolling.
 * Used for the data-map step which has a long list of sections.
 */
function PaneScrollable({ title, subtitle, body, actions }: PaneProps) {
  return (
    <div className="flex flex-col" style={{ maxHeight: 'calc(85vh - 120px)' }}>
      <div className="shrink-0 mb-4">
        <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
        {subtitle && <p className="text-base text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">{body}</div>
      <div className="shrink-0 flex justify-end pt-4 border-t border-border mt-4">{actions}</div>
    </div>
  );
}

/**
 * Helper: check whether the user has completed onboarding.
 */
export function hasCompletedOnboarding(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

/**
 * Helper: reset onboarding (for testing or "show onboarding again" feature).
 */
export function resetOnboarding(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(PROFESSION_STORAGE_KEY);
}

/**
 * Helper: retrieve the profession the user selected during onboarding.
 * Defaults to 'other' when onboarding was skipped or the key was never set.
 */
export function getOnboardingProfession(): Profession {
  const stored = localStorage.getItem(PROFESSION_STORAGE_KEY);
  if (
    stored === 'legal' ||
    stored === 'tax' ||
    stored === 'consulting' ||
    stored === 'advisor' ||
    stored === 'other'
  ) {
    return stored;
  }
  return 'other';
}
