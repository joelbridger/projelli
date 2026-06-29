/**
 * Ch5ChooseYourBrain — "Choose your AI"
 *
 * The heart of Keepance's animated onboarding, and the exact screen where
 * users have historically dropped off. This chapter re-presents the same 3-way
 * logic from AiSetupStep in the new metaphor-driven Chapter interface, reusing
 * its sub-components directly (ApiKeyExplainer, ProviderTutorialSteps,
 * ApiKeyTester, useProfessionCopy) and calling the same KeychainService.setKey
 * path that Settings uses.
 *
 * Sub-views (useState):
 *   'choose' — three metaphor cards
 *   'cloud'  — provider pick + key paste + test + save
 *   'local'  — guided local setup (Ch5LocalSetup; no terminal instructions)
 *   'wrap'   — 465 MB reassurance, shown for every path
 */

// Ch5 intentionally skips ChapterLayout: it manages its own multi-subview layout (choose/cloud/local/wrap).

/* eslint-disable keepance-i18n/no-hardcoded-string */

import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { cn } from '@/lib/utils';

import type { Chapter, ChapterContext } from '../engine/types';
import {
  SceneFrame,
  Brain,
  Cloud,
  House,
  PaperPlane,
  FilingCabinet,
} from '../scenes';
import { JOURNEY_STRINGS } from '../copy/strings';

import { ApiKeyExplainer } from '@/features/onboarding/ApiKeyExplainer';
import {
  PROVIDER_TUTORIALS,
  type ProviderId,
} from '@/features/onboarding/ProviderTutorialSteps';
import { ApiKeyTester } from '@/features/onboarding/ApiKeyTester';
import { useProfessionCopy } from '@/features/onboarding/useProfessionCopy';
import { openExternal } from '@/platform/utils/openExternal';
import { clearAiSetupDeferred } from '@/features/onboarding/aiSetupState';
import { Ch5LocalSetup } from './Ch5LocalSetup';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SubView = 'choose' | 'cloud' | 'local' | 'wrap';

const S = JOURNEY_STRINGS.ch5;

const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'openai', 'google'];
const PROVIDER_PLAIN_NAME: Record<ProviderId, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  google: 'Gemini',
};

// ---------------------------------------------------------------------------
// Chapter export
// ---------------------------------------------------------------------------

export const ch5ChooseYourBrain: Chapter = {
  id: 'choose-brain',
  title: 'Choose your AI',
  // canAdvance intentionally omitted — ch5 controls its own forward flow
  render: (ctx) => <Ch5View ctx={ctx} />,
};

// ---------------------------------------------------------------------------
// Root view component (all hooks live here)
// ---------------------------------------------------------------------------

interface Ch5ViewProps {
  ctx: ChapterContext;
}

function Ch5View({ ctx }: Ch5ViewProps) {
  const [view, setView] = useState<SubView>('choose');
  // Each sub-view owns its own heading ref; we store a callback ref map so the
  // active sub-view's heading can be focused whenever the view changes.
  const headingRefs = useRef<Partial<Record<SubView, HTMLHeadingElement | null>>>({});

  useEffect(() => {
    headingRefs.current[view]?.focus();
  }, [view]);

  const goToWrap = () => { setView('wrap'); };

  return (
    <div data-testid="ch5-root">
      {view === 'choose' && (
        <ChooseView
          headingRef={(el) => { headingRefs.current['choose'] = el; }}
          reducedMotion={ctx.reducedMotion}
          onPickCloud={() => { setView('cloud'); }}
          onPickLocal={() => { setView('local'); }}
          onPickLater={() => {
            ctx.setData({ aiChoice: 'later' });
            try { localStorage.setItem('keepance_ai_setup_deferred', 'true'); } catch { /* ignore */ }
            setView('wrap');
          }}
        />
      )}

      {view === 'cloud' && (
        <CloudView
          headingRef={(el) => { headingRefs.current['cloud'] = el; }}
          reducedMotion={ctx.reducedMotion}
          saveApiKey={ctx.actions.saveApiKey}
          onBack={() => { setView('choose'); }}
          onSaved={(provider) => {
            ctx.setData({ aiChoice: 'cloud', aiProvider: provider });
            goToWrap();
          }}
        />
      )}

      {view === 'local' && (
        <Ch5LocalSetup
          ctx={ctx}
          onBack={() => { setView('choose'); }}
          onReady={() => {
            ctx.setData({ aiChoice: 'local' });
            goToWrap();
          }}
        />
      )}

      {view === 'wrap' && (
        <WrapView
          headingRef={(el) => { headingRefs.current['wrap'] = el; }}
          reducedMotion={ctx.reducedMotion}
          onContinue={ctx.advance}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-view: choose (three metaphor cards)
// ---------------------------------------------------------------------------

interface ChooseViewProps {
  headingRef: React.RefCallback<HTMLHeadingElement>;
  reducedMotion: boolean;
  onPickCloud: () => void;
  onPickLocal: () => void;
  onPickLater: () => void;
}

function ChooseView({ headingRef, reducedMotion, onPickCloud, onPickLocal, onPickLater }: ChooseViewProps) {
  const professionCopy = useProfessionCopy();
  const costLine = professionCopy.estimatedCostDesc || S.choose.card1.costFallback;

  return (
    <div className="space-y-6">
      <div>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-3xl font-bold tracking-tight"
          style={{ color: 'var(--kp-navy)', outline: 'none' }}
          data-testid="ch5-choose-heading"
        >
          {S.choose.title}
        </h2>
        <p className="text-base text-muted-foreground mt-1">{S.choose.sub}</p>
      </div>

      <div className="space-y-3">
        {/* Card 1: Cloud */}
        <ChoiceCard
          testId="ch5-card-cloud"
          scene={
            <SceneFrame label="A paper plane heading to the cloud" className="h-16 w-16">
              <div className="relative h-16 w-16">
                <Cloud reducedMotion={reducedMotion} size={36} className="absolute bottom-0 right-0" />
                <PaperPlane reducedMotion={reducedMotion} size={32} className="absolute top-0 left-0" />
              </div>
            </SceneFrame>
          }
          title={S.choose.card1.title}
          badge={S.choose.card1.badge}
          body={`${S.choose.card1.body} ${costLine}`}
          onClick={onPickCloud}
          prominent
        />

        {/* Card 2: Local */}
        <ChoiceCard
          testId="ch5-card-local"
          scene={
            <SceneFrame label="A brain inside a house, representing local AI" className="h-16 w-16">
              <div className="relative h-16 w-16">
                <House reducedMotion={reducedMotion} size={56} className="absolute bottom-0 left-0" />
                <Brain reducedMotion={reducedMotion} size={30} className="absolute top-0 right-0" />
              </div>
            </SceneFrame>
          }
          title={S.choose.card2.title}
          badge={S.choose.card2.badge}
          body={S.choose.card2.body}
          onClick={onPickLocal}
        />

        {/* Card 3: Later */}
        <ChoiceCard
          testId="ch5-card-later"
          scene={
            <SceneFrame label="A calm scene, nothing urgent" className="h-16 w-16">
              <FilingCabinet reducedMotion={reducedMotion} size={48} />
            </SceneFrame>
          }
          title={S.choose.card3.title}
          body={S.choose.card3.body}
          onClick={onPickLater}
          muted
        />
      </div>
    </div>
  );
}

interface ChoiceCardProps {
  testId: string;
  scene: React.ReactNode;
  title: string;
  badge?: string;
  body: string;
  onClick: () => void;
  prominent?: boolean;
  muted?: boolean;
}

function ChoiceCard({ testId, scene, title, badge, body, onClick, prominent, muted }: ChoiceCardProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'group flex w-full items-start gap-4 rounded-lg border bg-card p-4 text-left',
        'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        muted
          ? 'border-border bg-muted/10 hover:bg-muted/20'
          : 'hover:bg-muted/30',
      )}
      style={prominent
        ? { borderColor: '#0a2540', boxShadow: '0 2px 10px rgba(10,37,64,0.12)' }
        : undefined}
    >
      <div className="shrink-0 flex items-center justify-center">{scene}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className={cn('text-sm font-semibold', muted ? 'text-foreground' : 'text-foreground')}>
            {title}
          </h3>
          {badge && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{body}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 self-center text-muted-foreground transition-colors group-hover:text-primary" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sub-view: cloud (pick provider, get key tutorial, paste, test, save)
// ---------------------------------------------------------------------------

interface CloudViewProps {
  headingRef: React.RefCallback<HTMLHeadingElement>;
  reducedMotion: boolean;
  /** Host-provided: stores the key AND refreshes live app key state + model list. */
  saveApiKey: (provider: ProviderId, key: string) => Promise<void>;
  onBack: () => void;
  onSaved: (provider: ProviderId) => void;
}

function CloudView({ headingRef, reducedMotion: _reducedMotion, saveApiKey, onBack, onSaved }: CloudViewProps) {
  const [provider, setProvider] = useState<ProviderId>('anthropic');
  const [keyText, setKeyText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tutorial = PROVIDER_TUTORIALS[provider];

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      // Route through the host actions channel so the real app's key state and
      // model list are refreshed (and the provider_connected diagnostic fires).
      await saveApiKey(provider, keyText.trim());
      clearAiSetupDeferred();
      onSaved(provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="ch5-cloud-view">
      <div>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-3xl font-bold tracking-tight"
          style={{ color: 'var(--kp-navy)', outline: 'none' }}
          data-testid="ch5-cloud-heading"
        >
          {S.cloud.title}
        </h2>
        <p className="text-base text-muted-foreground mt-1">{S.cloud.sub}</p>
      </div>

      {/* Provider picker — plain buttons with aria-pressed (no fake tablist/tab ARIA) */}
      <div
        className="flex gap-2"
        role="group"
        aria-label="AI provider"
        data-testid="ch5-provider-group"
      >
        {PROVIDER_ORDER.map((id) => {
          const selected = provider === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={selected}
              data-testid={`ch5-provider-tab-${id}`}
              onClick={() => {
                setProvider(id);
                setKeyText('');
                setError(null);
              }}
              className={cn(
                'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted/30',
              )}
            >
              {PROVIDER_PLAIN_NAME[id]}
            </button>
          );
        })}
      </div>

      {/* What is an API key? */}
      <ApiKeyExplainer defaultOpen />

      {/* Tutorial steps + "Open [provider]" button */}
      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">
            How to get your {PROVIDER_PLAIN_NAME[provider]} key
          </p>
          <Button
            type="button"
            size="sm"
            onClick={() => void openExternal(tutorial.consoleUrl)}
            data-testid={`ch5-open-console-${provider}`}
            className="gap-1.5"
          >
            Open {PROVIDER_PLAIN_NAME[provider]}
          </Button>
        </div>
        <ol className="space-y-2 text-xs text-muted-foreground">
          {tutorial.steps.map((step, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {i + 1}
              </span>
              <span>
                <span className="font-medium text-foreground">{step.title}.</span> {step.body}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Key input + tester */}
      <div className="space-y-2">
        <label htmlFor="ch5-key-input" className="text-sm font-medium text-foreground">
          {S.cloud.keyLabel(PROVIDER_PLAIN_NAME[provider])}
        </label>
        <Input
          id="ch5-key-input"
          type="password"
          placeholder={
            provider === 'anthropic' ? 'sk-ant-api03-...'
              : provider === 'openai' ? 'sk-...'
                : 'AIza...'
          }
          value={keyText}
          onChange={(e) => { setKeyText(e.target.value); }}
          className="font-mono"
          data-testid="ch5-key-input"
        />
        {keyText.trim() && <ApiKeyTester provider={provider} apiKey={keyText} />}
        {error && (
          <p className="text-xs text-destructive" data-testid="ch5-save-error">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-4 border-t border-border">
        <Button variant="ghost" onClick={onBack} disabled={saving} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          {S.cloud.backBtn}
        </Button>
        <Button
          onClick={() => void handleSave()}
          size="lg"
          disabled={!keyText.trim() || saving}
          data-testid="ch5-save-key"
        >
          {saving ? S.cloud.savingBtn : S.cloud.saveBtn}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-view: wrap (465 MB reassurance — shown for every path)
// ---------------------------------------------------------------------------

interface WrapViewProps {
  headingRef: React.RefCallback<HTMLHeadingElement>;
  reducedMotion: boolean;
  onContinue: () => void;
}

function WrapView({ headingRef, reducedMotion, onContinue }: WrapViewProps) {
  return (
    <div className="space-y-6" data-testid="ch5-wrap-view">
      <div className="flex justify-center">
        <SceneFrame label="A filing cabinet — your private search index" className="h-24 w-24">
          <FilingCabinet reducedMotion={reducedMotion} size={96} />
        </SceneFrame>
      </div>

      <div className="text-center space-y-2">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-3xl font-bold tracking-tight"
          style={{ color: 'var(--kp-navy)', outline: 'none' }}
          data-testid="ch5-wrap-heading"
        >
          {S.wrap.title}
        </h2>
        <p className="text-base text-muted-foreground leading-relaxed max-w-md mx-auto">
          {S.wrap.body}
        </p>
      </div>

      <div className="flex justify-center pt-4">
        <Button
          size="lg"
          onClick={onContinue}
          data-testid="ch5-wrap-continue"
        >
          {S.wrap.continueBtn}
        </Button>
      </div>
    </div>
  );
}
