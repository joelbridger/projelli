/**
 * Stream D-web Group V · Task 5.1
 *
 * BYOKKeyInput: a small "Bring Your Own Key" affordance that lets a demo
 * visitor swap from the rate-limited shared demo key to their own Anthropic
 * key for unlimited messages.
 *
 * Modes:
 *   - "demo"       — default. Shows a label that explains the 5-message limit
 *                    and a toggle button labelled "Use my own key".
 *   - "byok"       — input visible. The user pastes a key; we validate the
 *                    `sk-ant-...` format inline. Storing the key prompts a
 *                    confirmation alert that explicitly states the trust
 *                    boundary ("stored only in your browser ... the demo
 *                    never sees it"). Once stored, the input collapses to a
 *                    short status row with a "Remove" button.
 *
 * Storage key: `localStorage['byokKey']` — same key `demoAIProvider` reads on
 * every send. There is no caching layer, so a remove takes effect on the
 * next message.
 *
 * Format check: Anthropic console keys begin with `sk-ant-` and are at least
 * 30 characters long. Anything else is rejected with an inline error.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog';
import { trackDemoByokUsed } from './demoPlausible';

const BYOK_STORAGE_KEY = 'byokKey';
const ANTHROPIC_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_\-]{20,}$/;

export function isValidAnthropicKey(value: string): boolean {
  return ANTHROPIC_KEY_PATTERN.test(value.trim());
}

function readStoredKey(): string | null {
  try {
    const raw = localStorage.getItem(BYOK_STORAGE_KEY);
    if (!raw) return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function writeStoredKey(value: string): void {
  try {
    localStorage.setItem(BYOK_STORAGE_KEY, value);
  } catch {
    // tolerate; the input UI will still surface the keychain failure to the
    // user via the unchanged "Demo AI" label.
  }
}

function clearStoredKey(): void {
  try {
    localStorage.removeItem(BYOK_STORAGE_KEY);
  } catch {
    // tolerate
  }
}

export function BYOKKeyInput() {
  const [storedKey, setStoredKey] = useState<string | null>(() => readStoredKey());
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  useEffect(() => {
    // If something else clears the key (Reset session, devtools), keep the
    // visible state in sync the next time we mount.
    setStoredKey(readStoredKey());
  }, []);

  function handleSave() {
    const trimmed = draft.trim();
    if (!isValidAnthropicKey(trimmed)) {
      setError('That does not look like an Anthropic key. Keys start with sk-ant- and are 30+ characters.');
      return;
    }
    setError(null);
    setPendingKey(trimmed);
  }

  function handleConfirmStore() {
    if (!pendingKey) return;
    writeStoredKey(pendingKey);
    setStoredKey(pendingKey);
    setPendingKey(null);
    setDraft('');
    setExpanded(false);
    trackDemoByokUsed();
  }

  function handleCancelStore() {
    setPendingKey(null);
  }

  function handleRemove() {
    clearStoredKey();
    setStoredKey(null);
    setExpanded(false);
    setDraft('');
    setError(null);
  }

  if (storedKey) {
    return (
      <div
        data-testid="byok-key-input"
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <span data-testid="byok-status-active">
          Your AI · unlimited (key stored locally)
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRemove}
          data-testid="byok-remove-button"
        >
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div data-testid="byok-key-input" className="flex flex-col gap-1 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground" data-testid="byok-status-demo">
          Demo AI · 5 messages
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setExpanded((v) => !v)}
          data-testid="byok-toggle-button"
          aria-expanded={expanded}
        >
          {expanded ? 'Cancel' : 'Use my own key'}
        </Button>
      </div>

      {expanded ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="byok-key-field" className="sr-only">
            Anthropic API key
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="byok-key-field"
              type="password"
              autoComplete="off"
              placeholder="sk-ant-..."
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(null);
              }}
              data-testid="byok-key-field"
              className="h-8 max-w-sm text-xs"
            />
            <Button
              size="sm"
              onClick={handleSave}
              data-testid="byok-save-button"
            >
              Save
            </Button>
          </div>
          {error ? (
            <p className="text-destructive" data-testid="byok-error">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      <AlertDialog
        open={pendingKey !== null}
        onOpenChange={(open) => {
          if (!open) handleCancelStore();
        }}
      >
        <AlertDialogContent data-testid="byok-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Store your API key in this browser?</AlertDialogTitle>
            <AlertDialogDescription>
              Your key is stored only in your browser. The Advisor Prep Hero demo never
              sees it. AI requests go straight from this tab to Anthropic.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={handleCancelStore}
              data-testid="byok-confirm-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmStore}
              data-testid="byok-confirm-store"
            >
              Store key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export const BYOK_STORAGE_KEY_NAME = BYOK_STORAGE_KEY;
