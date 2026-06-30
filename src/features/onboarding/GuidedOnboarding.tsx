/**
 * GuidedOnboarding — premium 8-step first-run experience.
 *
 * Replaces FirstRunWizard as the full-screen onboarding overlay.  Keeps the
 * same trigger condition and completion semantics; adds the branded
 * OnboardingStepFrame rail, a Firm step, and per-step progress tracking.
 *
 * Steps (index 0-8):
 *   0  Welcome         — value prop, no gate
 *   1  Profession      — picker; Next gated on selection
 *   2  Make it yours   — name + photo (your sidebar identity); no gate
 *   3  Workspace       — explainer; no gate
 *   4  Trust           — DataMapContent accordion; no gate
 *   5  AI key          — AiSetupStep; skip/save/local all advance
 *   6  Connect email   — M365 / Gmail / IMAP tabs; "Connect later" advances
 *   7  Invite firm     — gated by useFirm role; firm admins also set name+logo
 *   8  Done            — sample-files toggle; Confirm marks complete
 */

/* eslint-disable lantern-i18n/no-hardcoded-string */

import { useState, useRef, type ReactNode } from 'react';
import { Button } from '@/ui/button';
import { Check, Upload, User, Building2, FileDown } from 'lucide-react';
import { useProfileStore } from '@/platform/profile/profileStore';
import { readImageAsDataUrl } from '@/platform/utils/imageUpload';
import { BRAND } from '@/config/brand';

import { OnboardingStepFrame, type StepInfo } from './OnboardingStepFrame';
import { markOnboardingComplete, setOnboardingProgressStep } from './onboardingState';
import { AiSetupStep } from './AiSetupStep';

import { MailConnect } from '@/platform/connectors/email/MailConnect';
import { MailGmailConnect } from '@/platform/connectors/email/MailGmailConnect';
import { MailImapConnect } from '@/platform/connectors/email/MailImapConnect';
import { FirmAdminConsole } from '@/features/firm/FirmAdminConsole';
import { FirmSignIn } from '@/features/firm/FirmSignIn';
import { DataMapDialog } from '@/platform/privacy/ui/DataMapDialog';
import { useFirm } from '@/platform/hooks/useFirm';
import { useRecordConfidentialityChoice } from '@/platform/hooks/useConfidentialityMode';

import { writeSampleFiles, getSamplesForProfession } from '@/platform/matter/samples';
import { persistProfessionModelDefault, getModelForProfession } from '@/platform/profile/professionModel';
import { useProfessionStore } from '@/platform/profile/professionStore';
import { markAiSetupDeferred } from '@/features/onboarding/aiSetupState';
import { useProfessionCopy } from '@/features/onboarding/useProfessionCopy';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import type { KeyProvider } from '@/platform/providers/KeychainService';
import type { ProviderId } from '@/features/onboarding/ProviderTutorialSteps';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Profession = 'legal' | 'tax' | 'consulting' | 'advisor' | 'other';

interface ProfessionOption {
  id: Profession;
  heading: string;
  description: string;
}

const PROFESSION_OPTIONS: ProfessionOption[] = [
  {
    id: 'advisor',
    heading: 'Financial advisor / wealth',
    description: 'RIAs, wealth managers, and financial planners. Comes with the Financial Advisory template pack.',
  },
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

type EmailTab = 'm365' | 'gmail' | 'imap';

/**
 * Minimal duck-typed workspace handle for sample-file writes.
 * Mirrors FirstRunWizardProps.workspace so callers can pass the same object.
 */
export interface OnboardingWorkspace {
  writeFile: (path: string, content: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
}

export interface GuidedOnboardingProps {
  /**
   * Persist a connected cloud API key.  Route through KeychainService.setKey,
   * then mirror into live API-key state so the AI pane sees it immediately.
   */
  onSaveKey: (provider: KeyProvider, key: string) => void | Promise<void>;
  /**
   * Called when the user clicks "Open Advisor Prep Hero" on the Done step, or when they
   * skip the entire flow.  opts.writeSamples signals whether sample files
   * should be written (the caller owns the workspace handle).
   */
  onComplete: (opts?: { writeSamples?: boolean }) => void;
  /** Already-connected API keys (provider -> key string). */
  apiKeys?: Record<string, string>;
  /** Optional workspace for writing sample files on Done. */
  workspace?: OnboardingWorkspace;
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const STEP_LABELS = [
  'Welcome',
  'Your practice',
  'Make it yours',
  'Your workspace',
  'Where your data goes',
  'Connect AI',
  'Connect email',
  'Your firm',
  'Done',
] as const;

type StepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GuidedOnboarding({
  onSaveKey,
  onComplete,
  workspace,
}: GuidedOnboardingProps) {
  const [activeIndex, setActiveIndex] = useState<StepIndex>(0);
  const [profession, setProfession] = useState<Profession | null>(null);
  const [emailTab, setEmailTab] = useState<EmailTab>('m365');
  const [populateSamples, setPopulateSamples] = useState(true);
  const [isFinishing, setIsFinishing] = useState(false);
  const [aiConnected, setAiConnected] = useState(false);
  // Guard: ensures handleDone and skipAll each run the completion path at most once.
  const completedRef = useRef(false);

  // Progress state for the rail badges
  const [doneSteps, setDoneSteps] = useState<Record<number, boolean>>({});

  const markStepDone = (i: number) => {
    setDoneSteps((prev) => ({ ...prev, [i]: true }));
  };

  const steps: StepInfo[] = STEP_LABELS.map((label, i) => ({
    label,
    done: Boolean(doneSteps[i]),
  }));

  const defaultProvider: ProviderId =
    getModelForProfession(profession).provider as ProviderId;

  const selectProfession = (id: Profession) => {
    setProfession(id);
    persistProfessionModelDefault(id);
    // NEW-001: sync the REACTIVE profession store immediately, not just at
    // onboarding completion. The AI-setup step (and every other profession-aware
    // string downstream) reads `useProfessionStore`; without this, a user who
    // picks "Financial advisor" still saw legal-era copy like "Recommended for
    // legal work" on the very next screen, because the store hadn't updated yet.
    useProfessionStore.getState().setProfession(id);
  };

  const advance = (from: StepIndex) => {
    markStepDone(from);
    setActiveIndex((Math.min(from + 1, 8)) as StepIndex);
  };

  const goBack = (to: StepIndex) => {
    setActiveIndex(to);
  };

  // Skip everything: mark complete immediately and call onComplete.
  // Hidden while isFinishing is true to prevent double-completion.
  const skipAll = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    markOnboardingComplete(profession ?? 'other');
    onComplete({ writeSamples: false });
  };

  const handleDone = async () => {
    if (completedRef.current) return;
    completedRef.current = true;
    setIsFinishing(true);
    try {
      if (populateSamples && workspace) {
        await writeSampleFiles(workspace, profession ?? 'other');
      }
      markStepDone(8);
      markOnboardingComplete(profession ?? 'other');
      onComplete({ writeSamples: populateSamples && Boolean(workspace) });
    } catch (err) {
      // Don't block on a failed sample copy — still complete onboarding.
      console.warn('[GuidedOnboarding] sample copy failed:', err instanceof Error ? err.message : String(err));
      markStepDone(8);
      markOnboardingComplete(profession ?? 'other');
      onComplete({ writeSamples: false });
    } finally {
      setIsFinishing(false);
    }
  };

  return (
    <OnboardingStepFrame
      steps={steps}
      activeIndex={activeIndex}
      onSkip={isFinishing ? undefined : skipAll}
    >
      {activeIndex === 0 && (
        <WelcomeStep
          onNext={() => { advance(0); }}
        />
      )}
      {activeIndex === 1 && (
        <ProfessionStep
          profession={profession}
          onSelect={selectProfession}
          onBack={() => { goBack(0); }}
          onNext={() => { advance(1); }}
        />
      )}
      {activeIndex === 2 && (
        <IdentityStep
          onBack={() => { goBack(1); }}
          onNext={() => { advance(2); }}
        />
      )}
      {activeIndex === 3 && (
        <WorkspaceStep
          onBack={() => { goBack(2); }}
          onNext={() => { advance(3); }}
        />
      )}
      {activeIndex === 4 && (
        <TrustStep
          onBack={() => { goBack(3); }}
          onNext={() => { advance(4); }}
        />
      )}
      {activeIndex === 5 && (
        <AiKeyStep
          defaultProvider={defaultProvider}
          onSaveKey={onSaveKey}
          onBack={() => { goBack(4); }}
          onAdvance={(connected?: boolean) => {
            if (connected) setAiConnected(true);
            setOnboardingProgressStep('ai-key', true);
            advance(5);
          }}
        />
      )}
      {activeIndex === 6 && (
        <EmailStep
          tab={emailTab}
          onTabChange={setEmailTab}
          onBack={() => { goBack(5); }}
          onAdvance={(connected) => {
            if (connected) setOnboardingProgressStep('email', true);
            advance(6);
          }}
        />
      )}
      {activeIndex === 7 && (
        <FirmStep
          onBack={() => { goBack(6); }}
          onAdvance={() => {
            setOnboardingProgressStep('firm', true);
            advance(7);
          }}
        />
      )}
      {activeIndex === 8 && (
        <DoneStep
          profession={profession}
          populateSamples={populateSamples}
          onToggleSamples={setPopulateSamples}
          isFinishing={isFinishing}
          aiConnected={aiConnected}
          onBack={() => { goBack(7); }}
          onConfirm={() => { void handleDone(); }}
        />
      )}
    </OnboardingStepFrame>
  );
}

// ---------------------------------------------------------------------------
// Step 0 — Welcome
// ---------------------------------------------------------------------------

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div data-testid="onboarding-step-welcome">
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 28, fontWeight: 800, color: 'var(--kp-navy)', letterSpacing: '-0.02em', marginBottom: 8 }}>
          {BRAND.messaging.onboardingHeadline}
        </h2>
        <p style={{ fontSize: 15, color: 'hsl(215.4 16.3% 44%)', lineHeight: 1.55 }}>
          Everything you work on stays on your machine. AI answers come with citations you can check.
          This takes about two minutes to set up.
        </p>
      </div>

      <ul style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 32, listStyle: 'none', padding: 0 }}>
        {[
          { title: 'Your files never leave your computer', body: 'Documents and client work stay local. No cloud upload, no Advisor Prep Hero content servers.' },
          { title: 'You own your AI connection', body: 'You connect your own AI account. Your work goes straight from your machine to your provider.' },
          { title: 'Every answer from your files is cited', body: 'Ask shows exactly which document each file-based claim came from — and always marks what is general guidance versus from your files.' },
        ].map(({ title, body }) => (
          <li key={title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 2,
              background: 'var(--kp-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Check size={12} color="#fff" />
            </span>
            <div>
              <p style={{ fontWeight: 600, fontSize: 14, color: 'hsl(222.2 84% 4.9%)', marginBottom: 2 }}>{title}</p>
              <p style={{ fontSize: 13, color: 'hsl(215.4 16.3% 44%)', lineHeight: 1.5 }}>{body}</p>
            </div>
          </li>
        ))}
      </ul>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <GradientButton onClick={onNext} data-testid="onboarding-next-welcome">
          Get started
        </GradientButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Profession
// ---------------------------------------------------------------------------

interface ProfessionStepProps {
  profession: Profession | null;
  onSelect: (id: Profession) => void;
  onBack: () => void;
  onNext: () => void;
}

function ProfessionStep({ profession, onSelect, onBack, onNext }: ProfessionStepProps) {
  return (
    <div data-testid="onboarding-step-profession">
      <Heading title="What kind of work do you do?" subtitle="We set up your practice with the right starting templates and defaults." />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 28 }}>
        {PROFESSION_OPTIONS.map((opt) => {
          const sel = profession === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              data-testid={`profession-card-${opt.id}`}
              onClick={() => { onSelect(opt.id); }}
              style={{
                borderRadius: 10, border: sel ? '2px solid var(--kp-navy)' : '1.5px solid hsl(214.3 31.8% 60%)',
                padding: 16, textAlign: 'left', cursor: 'pointer',
                background: sel ? 'rgba(10,37,64,0.06)' : '#fff',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <p style={{ fontSize: 14, fontWeight: 700, color: 'hsl(222.2 84% 4.9%)', marginBottom: 4 }}>{opt.heading}</p>
              <p style={{ fontSize: 12, color: 'hsl(215.4 16.3% 44%)', lineHeight: 1.45 }}>{opt.description}</p>
            </button>
          );
        })}
      </div>

      <StepFooter
        onBack={onBack}
        onNext={onNext}
        nextLabel={profession ? 'Continue' : 'Skip for now'}
        nextTestId="onboarding-next-profession"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Make it yours (name + photo)
// ---------------------------------------------------------------------------

function IdentityStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const soloName = useProfileStore((s) => s.soloName);
  const soloAvatar = useProfileStore((s) => s.soloAvatar);
  const setSoloName = useProfileStore((s) => s.setSoloName);
  const setSoloAvatar = useProfileStore((s) => s.setSoloAvatar);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setSoloAvatar(await readImageAsDataUrl(file));
    } catch {
      // ignore unreadable images
    }
  };

  return (
    <div data-testid="onboarding-step-identity">
      <Heading
        title="Make it yours"
        subtitle="Add your name and a photo. They show in your sidebar, and you can change them any time."
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <span style={{
          width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', flex: 'none',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'hsl(210 40% 96.1%)', border: '1.5px solid hsl(214.3 31.8% 80%)',
        }}>
          {soloAvatar
            ? <img src={soloAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <User size={28} strokeWidth={1.75} color="hsl(215.4 16.3% 50%)" />}
        </span>
        <div style={{ flex: 1 }}>
          <input
            value={soloName}
            onChange={(e) => { setSoloName(e.target.value); }}
            placeholder="Your name"
            aria-label="Your name"
            data-testid="onboarding-identity-name"
            style={{
              width: '100%', maxWidth: 340, border: '1.5px solid hsl(214.3 31.8% 70%)',
              borderRadius: 8, padding: '9px 12px', fontSize: 15, fontWeight: 600,
              color: 'var(--kp-navy)', fontFamily: 'var(--font-sans)', outline: 'none', marginBottom: 10,
            }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} data-testid="onboarding-identity-upload">
              <Upload size={14} style={{ marginRight: 6 }} /> Upload photo
            </Button>
            {soloAvatar && (
              <Button variant="ghost" size="sm" onClick={() => { setSoloAvatar(null); }}>Remove</Button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={(e) => { void handleFile(e); }}
              style={{ display: 'none' }}
              data-testid="onboarding-identity-file"
            />
          </div>
        </div>
      </div>

      <StepFooter onBack={onBack} onNext={onNext} nextTestId="onboarding-identity-next" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Workspace explainer
// ---------------------------------------------------------------------------

const CLOUD_SYNC_NOTE = "These folders sync to that company's cloud automatically, so your files leave your device through their app. For the strictest confidentiality, choose your local Documents folder.";

interface WorkspaceChoice {
  id: string;
  label: string;
  badge?: string;
  path: string;
  note?: string;
}

const WORKSPACE_CHOICES: WorkspaceChoice[] = [
  {
    id: 'documents',
    label: 'My Documents',
    badge: 'Recommended',
    path: '~/Documents/Advisor Prep Hero',
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    path: '~/Dropbox/Advisor Prep Hero',
    note: CLOUD_SYNC_NOTE,
  },
  {
    id: 'icloud',
    label: 'iCloud Drive',
    path: '~/Library/Mobile Documents/com~apple~CloudDocs/Advisor Prep Hero',
    note: CLOUD_SYNC_NOTE,
  },
];

function WorkspaceStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [selected, setSelected] = useState<string>('documents');

  return (
    <div data-testid="onboarding-step-workspace">
      <Heading
        title="Your workspace is a folder on your computer"
        subtitle="Advisor Prep Hero stores everything as plain files in a folder you choose. You own them."
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        {WORKSPACE_CHOICES.map((choice) => {
          const sel = selected === choice.id;
          return (
            <button
              key={choice.id}
              type="button"
              data-testid={`workspace-choice-${choice.id}`}
              onClick={() => { setSelected(choice.id); }}
              style={{
                borderRadius: 10,
                border: sel ? '2px solid var(--kp-navy)' : '1.5px solid hsl(214.3 31.8% 60%)',
                padding: '14px 16px',
                textAlign: 'left',
                cursor: 'pointer',
                background: sel ? 'rgba(10,37,64,0.06)' : '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'hsl(222.2 84% 4.9%)' }}>{choice.label}</span>
                  {choice.badge && (
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: 'var(--kp-navy)',
                      background: 'rgba(10,37,64,0.08)', borderRadius: 4, padding: '1px 7px',
                    }}>
                      {choice.badge}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 12, color: 'hsl(215.4 16.3% 44%)', fontFamily: 'ui-monospace, monospace' }}>
                  {choice.path}
                </span>
              </div>
              {sel && <Check size={16} color="var(--kp-navy)" style={{ flex: 'none' }} />}
            </button>
          );
        })}
      </div>

      {/* Show a cloud-sync caveat when Dropbox or iCloud is selected */}
      {(() => {
        const chosen = WORKSPACE_CHOICES.find((c) => c.id === selected);
        return chosen?.note ? (
          <p
            data-testid="workspace-cloud-sync-note"
            style={{
              fontSize: 12, color: 'hsl(38 92% 30%)', lineHeight: 1.5, marginBottom: 16,
              background: 'hsl(48 96% 89%)', border: '1px solid hsl(45 93% 70%)',
              borderRadius: 8, padding: '8px 12px',
            }}
          >
            {chosen.note}
          </p>
        ) : null;
      })()}

      <p style={{ fontSize: 12, color: 'hsl(215.4 16.3% 44%)', lineHeight: 1.5, marginBottom: 24 }}>
        You can change this later in Settings. Advisor Prep Hero never uploads your files. Note that cloud-synced folders (Dropbox, iCloud) will still sync them through those apps.
      </p>

      <StepFooter onBack={onBack} onNext={onNext} nextTestId="onboarding-workspace-next" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Trust / Data map
// ---------------------------------------------------------------------------

function TrustStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [dataMapOpen, setDataMapOpen] = useState(false);
  const entityLabel = useEntityLabel();

  return (
    <div data-testid="onboarding-step-trust">
      <Heading
        title="Where your data goes"
        subtitle="The short version, before we connect an AI account."
      />

      {/* Trust sentence — verbatim per spec */}
      <p
        data-testid="onboarding-trust-sentence"
        style={{
          fontSize: 14, color: 'hsl(222.2 84% 4.9%)', lineHeight: 1.6, marginBottom: 20,
          padding: '14px 16px', background: 'hsl(210 40% 96.1%)',
          border: '1.5px solid hsl(214.3 31.8% 85%)', borderRadius: 10,
        }}
      >
        {`Advisor Prep Hero runs on your computer. In Local-only mode, nothing about your ${entityLabel.other} leaves this device, not to me and not to any AI provider. Using any tool on client work can still be governed by your firm's policies, so here's exactly what Advisor Prep Hero does with your data. Read it, and hand it to your firm if you need to.`}
      </p>

      <ul style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 28, listStyle: 'none', padding: 0 }}>
        {([
          'Your files and notes stay on your computer.',
          'When you use your own AI account, your question goes straight from your machine to your provider with your key. Advisor Prep Hero is not in the middle.',
          'The only thing that automatically touches our servers is a license check, never your files or questions. You can optionally turn on anonymous analytics (no files, no prompts) in Settings.',
        ] as const).map((bullet) => (
          <li key={bullet} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 1,
              background: 'var(--kp-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Check size={12} color="#fff" />
            </span>
            <p style={{ fontSize: 14, color: 'hsl(222.2 84% 4.9%)', lineHeight: 1.55, margin: 0 }}>{bullet}</p>
          </li>
        ))}
      </ul>

      <button
        type="button"
        data-testid="onboarding-trust-open-data-map"
        onClick={() => { setDataMapOpen(true); }}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          color: 'var(--kp-navy)', fontSize: 13, fontWeight: 600, textDecoration: 'underline',
          marginBottom: 28, display: 'block',
        }}
      >
        Read the full data map
      </button>

      <DataMapDialog open={dataMapOpen} onOpenChange={setDataMapOpen} />

      <StepFooter onBack={onBack} onNext={onNext} nextLabel="Connect an AI provider" nextTestId="onboarding-data-continue" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — AI confidentiality choice (personal) + AI key setup
// ---------------------------------------------------------------------------

/**
 * Which sub-screen the AI key step is on.
 *
 * For personal installs: first show the informed confidentiality choice, then
 * branch into the existing AiSetupStep if the user picks Cloud, or advance
 * immediately if they pick Local-only or Decide later.
 *
 * Firm installs skip the choice screen entirely and go straight to AiSetupStep,
 * which is unchanged (the firm manages confidentiality mode via their admin
 * console and the Assured provider; the gate doesn't apply to them).
 */
type AiKeySubView = 'choice' | 'cloud-setup';

interface AiKeyStepProps {
  defaultProvider: ProviderId;
  onSaveKey: (provider: KeyProvider, key: string) => void | Promise<void>;
  onBack: () => void;
  onAdvance: (connected?: boolean) => void;
}

function AiKeyStep({ defaultProvider, onSaveKey, onBack, onAdvance }: AiKeyStepProps) {
  const firm = useFirm();
  const recordChoice = useRecordConfidentialityChoice();
  const [subView, setSubView] = useState<AiKeySubView>('choice');

  // Firm installs go straight to the existing AI setup (unchanged behavior).
  if (firm.isSignedIn && firm.hasActiveSeat) {
    return (
      <div data-testid="onboarding-step-ai-key">
        <AiSetupStep
          defaultProvider={defaultProvider}
          onBack={onBack}
          onOpenDataMap={() => {}}
          onSaveKey={async (provider, key) => {
            await onSaveKey(provider, key);
            onAdvance(true);
          }}
          onUseLocal={() => { onAdvance(true); }}
          onSkip={() => {
            markAiSetupDeferred();
            onAdvance(false);
          }}
        />
      </div>
    );
  }

  // Personal installs: informed choice first.
  if (subView === 'choice') {
    return (
      <div data-testid="onboarding-step-ai-key">
        <ConfidentialityChoiceStep
          onPickLocalOnly={() => {
            recordChoice('local-only');
            onAdvance(false);
          }}
          onPickCloud={() => {
            // Record the informed choice now; key setup follows.
            recordChoice('direct');
            setSubView('cloud-setup');
          }}
          onDecideLater={() => {
            // Advances WITHOUT recording (choiceMade stays false, gate stays blocking).
            markAiSetupDeferred();
            onAdvance(false);
          }}
          onBack={onBack}
        />
      </div>
    );
  }

  // Cloud path: show the existing AiSetupStep cloud flows.
  return (
    <div data-testid="onboarding-step-ai-key">
      <AiSetupStep
        defaultProvider={defaultProvider}
        onBack={() => { setSubView('choice'); }}
        onOpenDataMap={() => {}}
        onSaveKey={async (provider, key) => {
          await onSaveKey(provider, key);
          onAdvance(true);
        }}
        onUseLocal={() => { onAdvance(true); }}
        onSkip={() => {
          markAiSetupDeferred();
          onAdvance(false);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confidentiality choice screen — personal installs only
// ---------------------------------------------------------------------------

interface ConfidentialityChoiceStepProps {
  onPickLocalOnly: () => void;
  onPickCloud: () => void;
  onDecideLater: () => void;
  onBack: () => void;
}

function ConfidentialityChoiceStep({
  onPickLocalOnly,
  onPickCloud,
  onDecideLater,
  onBack,
}: ConfidentialityChoiceStepProps) {
  const entityLabel = useEntityLabel();
  return (
    <div data-testid="onboarding-confidentiality-choice">
      <Heading
        title="How should Advisor Prep Hero handle your AI?"
        subtitle="Advisor Prep Hero indexes and searches everything on your computer, with nothing leaving the machine. The one place your text can travel is when an AI writes an answer. Pick how you want that handled. You can change this anytime."
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
        {/* Option A — Local-only */}
        <button
          type="button"
          data-testid="confidentiality-choice-local"
          onClick={onPickLocalOnly}
          style={{
            borderRadius: 10,
            border: '1.5px solid hsl(214.3 31.8% 60%)',
            padding: '16px 18px',
            textAlign: 'left',
            cursor: 'pointer',
            background: '#fff',
            transition: 'border-color 0.15s, background 0.15s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color: 'hsl(142 71% 25%)',
              background: 'hsl(142 76% 93%)', borderRadius: 4, padding: '2px 7px',
              flexShrink: 0,
            }}>
              Most private
            </span>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'hsl(222.2 84% 4.9%)', margin: 0 }}>Local-only</p>
          </div>
          <p style={{ fontSize: 13, color: 'hsl(215.4 16.3% 44%)', lineHeight: 1.55, margin: 0 }}>
            No AI prompt or file is ever sent to a cloud AI. Answers are written by a model running on your own machine. You&apos;ll need a local model installed, and I&apos;ll help you set one up.
          </p>
        </button>

        {/* Option B — Cloud (BYOK-direct) */}
        <button
          type="button"
          data-testid="confidentiality-choice-cloud"
          onClick={onPickCloud}
          style={{
            borderRadius: 10,
            border: '2px solid var(--kp-navy)',
            padding: '16px 18px',
            textAlign: 'left',
            cursor: 'pointer',
            background: 'rgba(10,37,64,0.04)',
            boxShadow: '0 2px 10px rgba(10,37,64,0.10)',
            transition: 'border-color 0.15s, background 0.15s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color: 'var(--kp-navy)',
              background: 'rgba(10,37,64,0.08)', borderRadius: 4, padding: '2px 7px',
              flexShrink: 0,
            }}>
              Recommended
            </span>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'hsl(222.2 84% 4.9%)', margin: 0 }}>Cloud (bring your own key)</p>
          </div>
          <p style={{ fontSize: 13, color: 'hsl(215.4 16.3% 44%)', lineHeight: 1.55, margin: 0 }}>
            {`Faster and stronger answers from your own OpenAI, Anthropic, or Google account. Your prompt and the ${entityLabel.one} context it needs go to that provider. Check your firm's policy before you use this on client work.`}
          </p>
        </button>
      </div>

      {/* Tertiary action — Decide later */}
      <div style={{ marginBottom: 28 }}>
        <button
          type="button"
          data-testid="confidentiality-choice-later"
          onClick={onDecideLater}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            color: 'hsl(215.4 16.3% 44%)', fontSize: 13, textDecoration: 'underline',
          }}
        >
          Decide later (stays local-only until you choose)
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-start', paddingTop: 16, borderTop: '1px solid hsl(214.3 31.8% 90%)' }}>
        <Button variant="ghost" onClick={onBack}>Back</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 6 — Connect email
// ---------------------------------------------------------------------------

type EmailTabId = 'm365' | 'gmail' | 'imap';

interface EmailStepProps {
  tab: EmailTabId;
  onTabChange: (t: EmailTabId) => void;
  onBack: () => void;
  /** connected=true marks the email step done; false (Connect later) does not. */
  onAdvance: (connected: boolean) => void;
}

const EMAIL_TABS: { id: EmailTabId; label: string }[] = [
  { id: 'm365', label: 'Microsoft 365' },
  { id: 'gmail', label: 'Gmail' },
  { id: 'imap', label: 'Other (IMAP)' },
];

function EmailStep({ tab, onTabChange, onBack, onAdvance }: EmailStepProps) {
  return (
    <div data-testid="onboarding-step-email">
      <Heading
        title="Connect your email"
        subtitle="Advisor Prep Hero indexes your email locally so you can search and cite it. Nothing is uploaded."
      />

      {/* Provider tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }} role="tablist" aria-label="Email provider">
        {EMAIL_TABS.map(({ id, label }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`email-tab-${id}`}
              onClick={() => { onTabChange(id); }}
              style={{
                flex: 1, borderRadius: 8, padding: '7px 10px', fontSize: 13, fontWeight: 600,
                border: active ? '1.5px solid var(--kp-navy)' : '1.5px solid hsl(214.3 31.8% 60%)',
                background: active ? 'rgba(10,37,64,0.07)' : '#fff',
                color: active ? 'var(--kp-navy)' : 'hsl(215.4 16.3% 44%)',
                cursor: 'pointer', transition: 'border-color 0.12s, background 0.12s',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Real Mail* components — no restyling */}
      <div style={{ marginBottom: 20 }}>
        {tab === 'm365' && <MailConnect />}
        {tab === 'gmail' && <MailGmailConnect />}
        {tab === 'imap' && <MailImapConnect />}
      </div>

      {/* Connector-access: honest "we read your exports" note. Advisor Prep Hero reads
          the plan reports / meeting notes other tools export into your files,
          email, or cloud folders — it is NOT an integration with those tools.
          Wording verified against the 2026-06-29 connector-access strategy doc's
          "what we can honestly claim" table (never "integration"). */}
      <div
        data-testid="onboarding-reads-exports"
        style={{
          display: 'flex', gap: 10, alignItems: 'flex-start',
          marginBottom: 20, padding: '12px 14px', borderRadius: 10,
          background: 'rgba(10,37,64,0.04)', border: '1px solid hsl(214.3 31.8% 90%)',
        }}
      >
        <FileDown size={16} strokeWidth={1.75} style={{ marginTop: 2, flex: 'none', color: 'var(--kp-accent)' }} aria-hidden="true" />
        <div style={{ fontSize: 13, lineHeight: 1.5, color: 'hsl(215.4 16.3% 36%)' }}>
          <strong style={{ color: 'var(--kp-navy)', fontWeight: 600 }}>Already use RightCapital or Jump?</strong>{' '}
          Advisor Prep Hero also reads the plan reports and meeting notes you export or save from tools like
          RightCapital and Jump, once they land in your files, email, or cloud folders. It files each
          to the right client and shows when it was exported. Advisor Prep Hero reads your exported files; it
          is not an integration with those tools.
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTop: '1px solid hsl(214.3 31.8% 90%)' }}>
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button
            variant="outline"
            onClick={() => { onAdvance(false); }}
            data-testid="email-connect-later"
          >
            Connect later
          </Button>
          <GradientButton onClick={() => { onAdvance(true); }} data-testid="onboarding-email-continue">
            Continue
          </GradientButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 7 — Firm members
// ---------------------------------------------------------------------------

/**
 * Firm branding for a signed-in admin: the firm name (prefilled from the
 * subscription's org name) plus an uploadable logo. Both show in the sidebar
 * for firm seats. Writes the cosmetic override in profileStore.
 */
function FirmBranding({ orgName }: { orgName: string | null }) {
  const firmName = useProfileStore((s) => s.firmName);
  const firmLogo = useProfileStore((s) => s.firmLogo);
  const setFirmName = useProfileStore((s) => s.setFirmName);
  const setFirmLogo = useProfileStore((s) => s.setFirmLogo);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setFirmLogo(await readImageAsDataUrl(file));
    } catch {
      // ignore unreadable images
    }
  };

  return (
    <div
      data-testid="firm-branding"
      style={{
        display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, padding: 16,
        border: '1.5px solid hsl(214.3 31.8% 85%)', borderRadius: 10, background: '#fff',
      }}
    >
      <span style={{
        width: 56, height: 56, borderRadius: '50%', overflow: 'hidden', flex: 'none',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'hsl(210 40% 96.1%)', border: '1.5px solid hsl(214.3 31.8% 80%)',
      }}>
        {firmLogo
          ? <img src={firmLogo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Building2 size={24} strokeWidth={1.75} color="hsl(215.4 16.3% 50%)" />}
      </span>
      <div style={{ flex: 1 }}>
        <input
          value={firmName}
          onChange={(e) => { setFirmName(e.target.value); }}
          placeholder={orgName || 'Firm name'}
          aria-label="Firm name"
          data-testid="firm-branding-name"
          style={{
            width: '100%', maxWidth: 320, border: '1.5px solid hsl(214.3 31.8% 70%)',
            borderRadius: 8, padding: '8px 11px', fontSize: 14, fontWeight: 600,
            color: 'var(--kp-navy)', fontFamily: 'var(--font-sans)', outline: 'none', marginBottom: 9,
          }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} data-testid="firm-branding-upload">
            <Upload size={14} style={{ marginRight: 6 }} /> Upload logo
          </Button>
          {firmLogo && (
            <Button variant="ghost" size="sm" onClick={() => { setFirmLogo(null); }}>Remove</Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={(e) => { void handleFile(e); }}
            style={{ display: 'none' }}
            data-testid="firm-branding-file"
          />
        </div>
      </div>
    </div>
  );
}

interface FirmStepProps {
  onBack: () => void;
  onAdvance: () => void;
}

type FirmOption = 'create' | 'join';

function FirmStep({ onBack, onAdvance }: FirmStepProps) {
  const firm = useFirm();
  const professionCopy = useProfessionCopy();
  const entityLabel = useEntityLabel();
  const [selectedOption, setSelectedOption] = useState<FirmOption | null>(null);

  let content: ReactNode;

  if (firm.isSignedIn && firm.role === 'admin') {
    // Signed in as admin: show the real admin console
    content = (
      <div data-testid="firm-admin-content">
        <p style={{ fontSize: 13, color: 'hsl(215.4 16.3% 44%)', marginBottom: 16, lineHeight: 1.5 }}>
          {`You are signed in as a firm admin. Set your firm name and logo, then invite members and manage ${entityLabel.other} below.`}
        </p>
        <FirmBranding orgName={firm.org?.name ?? null} />
        <FirmAdminConsole />
      </div>
    );
  } else if (firm.isSignedIn && firm.role !== 'admin') {
    // Signed in as a non-admin member
    content = (
      <div data-testid="firm-member-note" style={{ borderRadius: 10, border: '1.5px solid hsl(214.3 31.8% 60%)', background: 'hsl(210 40% 96.1%)', padding: 20 }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'hsl(222.2 84% 4.9%)', marginBottom: 6 }}>Your firm admin manages members</p>
        <p style={{ fontSize: 13, color: 'hsl(215.4 16.3% 44%)', lineHeight: 1.5 }}>
          Only a firm admin can invite or remove members. You are all set. Continue to finish setup.
        </p>
      </div>
    );
  } else {
    // Not signed in: show three equally-weighted option cards.
    content = (
      <div data-testid="firm-signin-content">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 4 }}>

          {/* Create a firm */}
          <div data-testid="firm-option-create">
            <button
              type="button"
              onClick={() => { setSelectedOption(selectedOption === 'create' ? null : 'create'); }}
              style={{
                width: '100%',
                textAlign: 'left',
                borderRadius: selectedOption === 'create' ? '10px 10px 0 0' : 10,
                border: selectedOption === 'create'
                  ? '2px solid var(--kp-navy)'
                  : '1.5px solid hsl(214.3 31.8% 60%)',
                padding: '14px 16px',
                cursor: 'pointer',
                background: selectedOption === 'create' ? 'rgba(10,37,64,0.06)' : '#fff',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <p style={{ fontSize: 14, fontWeight: 700, color: 'hsl(222.2 84% 4.9%)', marginBottom: 3 }}>
                Create a firm
              </p>
              <p style={{ fontSize: 12, color: 'hsl(215.4 16.3% 44%)', lineHeight: 1.45, margin: 0 }}>
                You're setting Advisor Prep Hero up for your practice or team. You'll claim the org and become the admin. Requires a Firm-plan license key.
              </p>
            </button>
            {selectedOption === 'create' && (
              <div
                style={{
                  border: '2px solid var(--kp-navy)',
                  borderTop: 'none',
                  borderRadius: '0 0 10px 10px',
                  padding: '16px 16px 12px',
                  background: '#fff',
                }}
              >
                <button
                  type="button"
                  onClick={() => { setSelectedOption(null); }}
                  style={{
                    fontSize: 12, color: 'hsl(215.4 16.3% 44%)', background: 'none',
                    border: 'none', cursor: 'pointer', padding: '0 0 10px',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <span style={{ fontSize: 14 }}>&#8592;</span> Back to options
                </button>
                <FirmSignIn initialPanel="claim" />
              </div>
            )}
          </div>

          {/* Join your firm */}
          <div data-testid="firm-option-join">
            <button
              type="button"
              onClick={() => { setSelectedOption(selectedOption === 'join' ? null : 'join'); }}
              style={{
                width: '100%',
                textAlign: 'left',
                borderRadius: selectedOption === 'join' ? '10px 10px 0 0' : 10,
                border: selectedOption === 'join'
                  ? '2px solid var(--kp-navy)'
                  : '1.5px solid hsl(214.3 31.8% 60%)',
                padding: '14px 16px',
                cursor: 'pointer',
                background: selectedOption === 'join' ? 'rgba(10,37,64,0.06)' : '#fff',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <p style={{ fontSize: 14, fontWeight: 700, color: 'hsl(222.2 84% 4.9%)', marginBottom: 3 }}>
                Join your firm
              </p>
              <p style={{ fontSize: 12, color: 'hsl(215.4 16.3% 44%)', lineHeight: 1.45, margin: 0 }}>
                Your firm already uses Advisor Prep Hero. Sign in with your firm account or activate your seat with a license key.
              </p>
            </button>
            {selectedOption === 'join' && (
              <div
                style={{
                  border: '2px solid var(--kp-navy)',
                  borderTop: 'none',
                  borderRadius: '0 0 10px 10px',
                  padding: '16px 16px 12px',
                  background: '#fff',
                }}
              >
                <button
                  type="button"
                  onClick={() => { setSelectedOption(null); }}
                  style={{
                    fontSize: 12, color: 'hsl(215.4 16.3% 44%)', background: 'none',
                    border: 'none', cursor: 'pointer', padding: '0 0 10px',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <span style={{ fontSize: 14 }}>&#8592;</span> Back to options
                </button>
                <FirmSignIn initialPanel="signin" />
              </div>
            )}
          </div>

          {/* Continue solo */}
          <div data-testid="firm-option-solo">
            <button
              type="button"
              data-testid="firm-solo-skip"
              onClick={onAdvance}
              style={{
                width: '100%',
                textAlign: 'left',
                borderRadius: 10,
                border: '1.5px solid hsl(214.3 31.8% 60%)',
                padding: '14px 16px',
                cursor: 'pointer',
                background: '#fff',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <p style={{ fontSize: 14, fontWeight: 700, color: 'hsl(222.2 84% 4.9%)', marginBottom: 3 }}>
                Continue solo
              </p>
              <p style={{ fontSize: 12, color: 'hsl(215.4 16.3% 44%)', lineHeight: 1.45, margin: 0 }}>
                You work alone. Everything stays local. You can connect to a firm later in Settings.
              </p>
            </button>
          </div>

        </div>
      </div>
    );
  }

  return (
    <div data-testid="onboarding-step-firm">
      <Heading
        title="How do you practice?"
        subtitle={professionCopy.soloOrTeamDesc}
      />

      <div style={{ marginBottom: 20 }}>{content}</div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTop: '1px solid hsl(214.3 31.8% 90%)' }}>
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <GradientButton onClick={onAdvance} data-testid="onboarding-firm-continue">
          Continue
        </GradientButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 8 — Done
// ---------------------------------------------------------------------------

interface DoneStepProps {
  profession: Profession | null;
  populateSamples: boolean;
  onToggleSamples: (v: boolean) => void;
  isFinishing: boolean;
  aiConnected: boolean;
  onBack: () => void;
  onConfirm: () => void;
}

function getSampleLabel(profession: Profession | null): string {
  switch (profession) {
    case 'legal': return 'legal matters';
    case 'tax': return 'tax files';
    case 'consulting': return 'consulting files';
    case 'advisor': return 'advisory files';
    default: return 'files';
  }
}

function DoneStep({ profession, populateSamples, onToggleSamples, isFinishing, aiConnected, onBack, onConfirm }: DoneStepProps) {
  const sampleCount = getSamplesForProfession(profession ?? 'other').length;
  const sampleLabel = getSampleLabel(profession);
  const entityLabel = useEntityLabel();

  return (
    <div data-testid="onboarding-step-done">
      <Heading
        title="You are set up"
        subtitle={`Create your first ${entityLabel.one} to get started.`}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
        {/* Sample files toggle */}
        <label
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 12, borderRadius: 10,
            border: '1.5px solid hsl(214.3 31.8% 60%)', padding: 16, cursor: 'pointer',
            background: 'hsl(210 40% 96.1%)',
          }}
        >
          <input
            type="checkbox"
            data-testid="onboarding-samples-toggle"
            checked={populateSamples}
            onChange={(e) => { onToggleSamples(e.target.checked); }}
            style={{ marginTop: 2, accentColor: 'var(--kp-navy)' }}
          />
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'hsl(222.2 84% 4.9%)', marginBottom: 4 }}>
              Add sample {sampleLabel} so I can try things before adding real clients
            </p>
            <p style={{ fontSize: 12, color: 'hsl(215.4 16.3% 44%)', lineHeight: 1.5 }}>
              Adds {sampleCount} realistic {sampleCount === 1 ? 'sample' : 'samples'} to your workspace. You can delete them any time.
            </p>
          </div>
        </label>

        {!aiConnected && (
          <p data-testid="onboarding-done-no-ai-note" style={{ fontSize: 13, color: 'hsl(215.4 16.3% 44%)', lineHeight: 1.55, margin: 0 }}>
            Connect an AI in Settings whenever you are ready. Your files and templates work without one.
          </p>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTop: '1px solid hsl(214.3 31.8% 90%)' }}>
        <Button variant="ghost" onClick={onBack} disabled={isFinishing}>Back</Button>
        <GradientButton
          onClick={onConfirm}
          disabled={isFinishing}
          data-testid="onboarding-done-confirm"
        >
          {isFinishing ? 'Setting up...' : populateSamples ? `Explore the sample ${entityLabel.one}` : `Create your first ${entityLabel.one}`}
        </GradientButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--kp-navy)', letterSpacing: '-0.02em', marginBottom: 6 }}>
        {title}
      </h2>
      {subtitle && (
        <p style={{ fontSize: 14, color: 'hsl(215.4 16.3% 44%)', lineHeight: 1.55 }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

interface StepFooterProps {
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextTestId?: string;
}

function StepFooter({ onBack, onNext, nextLabel = 'Continue', nextTestId }: StepFooterProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTop: '1px solid hsl(214.3 31.8% 90%)' }}>
      <Button variant="ghost" onClick={onBack}>Back</Button>
      <GradientButton onClick={onNext} data-testid={nextTestId}>
        {nextLabel}
      </GradientButton>
    </div>
  );
}

interface GradientButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

function GradientButton({ children, style, ...rest }: GradientButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      style={{
        background: 'var(--kp-accent)',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        padding: '9px 22px',
        fontSize: 14,
        fontWeight: 700,
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        opacity: rest.disabled ? 0.55 : 1,
        fontFamily: 'var(--font-sans)',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
