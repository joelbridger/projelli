/**
 * FirstRunWizard — onboarding wizard shown to new users on their first launch.
 *
 * Walks the user through:
 *   1. Welcome / value prop
 *   2. Pick a workspace location
 *   3. (Optional) Paste an AI provider API key — can be skipped
 *   4. (Optional) Run a sample workflow to see the magic moment
 *   5. Done — drop them into the workspace
 *
 * Triggered when:
 *   - The app launches with no recent workspaces (`workspaceStore.recentWorkspaces.length === 0`)
 *   - AND no `projelli_onboarding_complete` flag in localStorage
 *
 * Sets `projelli_onboarding_complete = "true"` after the user finishes (or skips).
 *
 * Designed to be embedded inside the existing WorkspaceSelector flow rather
 * than replacing it — we want to honor the existing path-input vs file-picker
 * logic for browser vs Tauri modes.
 */

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { writeSampleFiles, SAMPLE_FILES } from '@/onboarding/samples';

const STORAGE_KEY = 'projelli_onboarding_complete';

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
}

type Step = 'welcome' | 'workspace' | 'apikey' | 'demo' | 'done';

export function FirstRunWizard({ onComplete, onSkip, workspace }: FirstRunWizardProps) {
  const [step, setStep] = useState<Step>('welcome');
  const [apiKey, setApiKey] = useState('');
  // Q11 (Wave 1.5): default ON — new users benefit from seeing realistic
  // artifacts before they run their first workflow.
  const [populateSamples, setPopulateSamples] = useState(true);
  const [isFinishing, setIsFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const markComplete = async () => {
    setFinishError(null);
    if (populateSamples && workspace) {
      setIsFinishing(true);
      try {
        await writeSampleFiles(workspace);
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
    localStorage.setItem(STORAGE_KEY, 'true');
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl">
        {/* Progress indicator */}
        <div className="flex items-center justify-between px-8 pt-6">
          <div className="flex gap-2">
            {(['welcome', 'workspace', 'apikey', 'demo'] as Step[]).map((s) => {
              const order: Step[] = ['welcome', 'workspace', 'apikey', 'demo', 'done'];
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
            Skip for now
          </button>
        </div>

        <div className="px-8 py-8">
          {step === 'welcome' && (
            <Pane
              title="Welcome to Projelli"
              subtitle="The AI workspace where every chat becomes a real file."
              body={
                <div className="space-y-4 text-sm text-muted-foreground">
                  <p>
                    Projelli is a desktop app that combines a Markdown editor with an AI chat interface. Every conversation produces real,
                    persistent files in a folder on your computer — not throwaway chat bubbles.
                  </p>
                  <p>
                    This setup takes about 2 minutes. We'll help you pick a workspace folder, set up an AI provider (optional), and run your
                    first workflow.
                  </p>
                  <ul className="space-y-2 mt-4 text-xs">
                    <li>📁 Step 1 — Pick a workspace folder</li>
                    <li>🔑 Step 2 — Add an AI provider key (optional)</li>
                    <li>✨ Step 3 — Run your first workflow</li>
                  </ul>
                </div>
              }
              actions={
                <Button onClick={() => setStep('workspace')} size="lg">
                  Let's go →
                </Button>
              }
            />
          )}

          {step === 'workspace' && (
            <Pane
              title="Pick a workspace folder"
              subtitle="This is where all your work will live."
              body={
                <div className="space-y-4 text-sm text-muted-foreground">
                  <p>
                    Projelli stores everything as plain Markdown files in a folder on your hard drive. Pick a location that's easy to find
                    and easy to back up.
                  </p>
                  <p>
                    <strong className="text-foreground">Pro tip:</strong> If you put this folder inside Dropbox, iCloud, or OneDrive, you'll
                    get automatic sync across all your devices for free.
                  </p>
                  <div className="rounded-lg border border-border bg-muted/30 p-4">
                    <p className="text-xs font-medium text-foreground mb-2">Common choices:</p>
                    <ul className="text-xs space-y-1 font-mono">
                      <li>~/Documents/Projelli</li>
                      <li>~/Dropbox/Projelli</li>
                      <li>~/iCloud Drive/Projelli</li>
                    </ul>
                  </div>
                  <p className="text-xs">
                    The next screen will let you actually pick the folder. For now, just confirm you understand what we're about to ask.
                  </p>
                </div>
              }
              actions={
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep('welcome')}>
                    ← Back
                  </Button>
                  <Button onClick={() => setStep('apikey')} size="lg">
                    Got it →
                  </Button>
                </div>
              }
            />
          )}

          {step === 'apikey' && (
            <Pane
              title="Add an AI provider key"
              subtitle="Optional, but you'll need one to use the AI features."
              body={
                <div className="space-y-4 text-sm text-muted-foreground">
                  <p>
                    Projelli is a "bring your own key" tool — you sign up with an AI provider directly and paste their API key here. Your
                    keys are stored in your operating system's secure keychain and never leave your computer.
                  </p>
                  <p>
                    The fastest way to get started is with <strong className="text-foreground">Anthropic Claude</strong>:
                  </p>
                  <ol className="space-y-1 text-xs ml-4 list-decimal">
                    <li>
                      Go to{' '}
                      <a
                        href="https://console.anthropic.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        console.anthropic.com
                      </a>
                    </li>
                    <li>Sign up (free, $5 in credits to start)</li>
                    <li>Click API Keys → Create Key</li>
                    <li>Copy the key (starts with <code className="text-foreground">sk-ant-</code>) and paste it below</li>
                  </ol>
                  <div className="pt-2">
                    <Input
                      type="password"
                      placeholder="sk-ant-api03-..."
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      You can skip this and add a key later in Settings → API Keys.
                    </p>
                  </div>
                </div>
              }
              actions={
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep('workspace')}>
                    ← Back
                  </Button>
                  <Button variant="outline" onClick={() => setStep('demo')}>
                    Skip for now
                  </Button>
                  <Button onClick={() => setStep('demo')} size="lg" disabled={!apiKey.trim()}>
                    Save key →
                  </Button>
                </div>
              }
            />
          )}

          {step === 'demo' && (
            <Pane
              title="Run your first workflow"
              subtitle="See the magic moment in action."
              body={
                <div className="space-y-4 text-sm text-muted-foreground">
                  <p>
                    The fastest way to understand what Projelli does is to run a workflow. We recommend starting with{' '}
                    <strong className="text-foreground">New Business Kickoff</strong> — it asks you a series of questions about a business
                    idea (rough is fine!) and produces real, editable Markdown files in your workspace.
                  </p>
                  <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                        1
                      </span>
                      Click <strong className="text-foreground">Workflows</strong> in the sidebar
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                        2
                      </span>
                      Pick <strong className="text-foreground">New Business Kickoff</strong>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                        3
                      </span>
                      Answer the questions and click <strong className="text-foreground">Generate</strong>
                    </div>
                  </div>
                  <p className="text-xs">
                    You'll get back a Vision document, a PRD, and a Lean Canvas — all as real Markdown files you can edit, link together,
                    and back up however you want.
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
                        Populate workspace with {SAMPLE_FILES.length} sample files
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        Adds finished examples of a pricing strategy, pitch deck, and weekly review so you can see what
                        a completed workflow looks like. You can delete them later.
                      </p>
                    </div>
                  </label>

                  {finishError && (
                    <p className="text-xs text-destructive">
                      Could not copy samples: {finishError}. Don't worry, you're still in.
                    </p>
                  )}
                </div>
              }
              actions={
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep('apikey')} disabled={isFinishing}>
                    ← Back
                  </Button>
                  <Button onClick={markComplete} size="lg" disabled={isFinishing}>
                    {isFinishing ? 'Setting up...' : 'Open my workspace →'}
                  </Button>
                </div>
              }
            />
          )}
        </div>
      </div>
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
}
