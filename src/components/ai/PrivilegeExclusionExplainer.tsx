/**
 * F-121 (VG-5b) — privilege exclusion explained in-product, with proof.
 *
 * The "Include privileged" toggle existed, but nothing in the product
 * explained that the exclusion really happens in the retrieval engine (not
 * as a cosmetic label). This is an info button next to the toggle that opens
 * a small dialog with:
 *   1. one plain sentence saying WHERE the exclusion is enforced, and
 *   2. a "see it work" demonstration that runs the user's own current
 *      question through retrieval twice — default (privileged excluded) and
 *      explicitly included — and reports exactly what was withheld, by name.
 *
 * The demonstration runs against the user's own index via `ragRetrieve`
 * (desktop only; the browser demo gets an honest "runs in the desktop app"
 * note). The diff itself is pure — see `summarizePrivilegeDiff`.
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ragRetrieve, type RagHit, type RetrievalScope } from '@/utils/tauri-commands';
import { summarizePrivilegeDiff } from '@/modules/memory/privilegeDiff';

/** The demo runner's shape — `ragRetrieve` in production, a mock in tests. */
export type ExplainerRetrieve = (
  query: string,
  topK: number,
  scope: RetrievalScope,
  includePrivileged: boolean,
) => Promise<Pick<RagHit, 'id' | 'path'>[]>;

/** Matches the chat's retrieval depth closely enough to be representative. */
const DEMO_TOP_K = 8;

interface PrivilegeExclusionExplainerProps {
  /**
   * The question to demonstrate with: the chat input draft, or the last
   * user message when the draft is empty (AIChatViewer computes this).
   */
  query: string;
  /** The chat's CURRENT retrieval scope — the demo must search what the chat would. */
  scope: RetrievalScope;
  /** Test seam; defaults to the real desktop retrieval. */
  retrieve?: ExplainerRetrieve;
}

type DemoState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'desktop-only' }
  | { kind: 'result'; withheldCount: number; topWithheldBasename: string | null };

export function PrivilegeExclusionExplainer({
  query,
  scope,
  retrieve = ragRetrieve,
}: PrivilegeExclusionExplainerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [demo, setDemo] = useState<DemoState>({ kind: 'idle' });

  const trimmedQuery = query.trim();

  const runDemo = useCallback(async () => {
    if (trimmedQuery.length === 0) return;
    setDemo({ kind: 'running' });
    try {
      // Same question, same scope, both ways. The set difference is exactly
      // what the exclusion is withholding from this question right now.
      const [excluded, included] = await Promise.all([
        retrieve(trimmedQuery, DEMO_TOP_K, scope, false),
        retrieve(trimmedQuery, DEMO_TOP_K, scope, true),
      ]);
      setDemo({ kind: 'result', ...summarizePrivilegeDiff(excluded, included) });
    } catch {
      // Outside the desktop app `ragRetrieve` throws — say so honestly
      // instead of pretending the check ran.
      setDemo({ kind: 'desktop-only' });
    }
  }, [trimmedQuery, scope, retrieve]);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    // Reset on close so reopening (possibly with a new question) starts clean.
    if (!next) setDemo({ kind: 'idle' });
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          data-testid="privilege-explainer-trigger"
          variant="ghost"
          size="sm"
          className="px-1.5 text-muted-foreground hover:text-foreground"
          aria-label={t('ai.privilege-explainer.title')}
          title={t('ai.privilege-explainer.title')}
        >
          <Info className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="privilege-explainer" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('ai.privilege-explainer.title')}</DialogTitle>
          <DialogDescription>{t('ai.privilege-explainer.body')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Button
            data-testid="privilege-explainer-demo"
            variant="outline"
            size="sm"
            onClick={() => void runDemo()}
            disabled={demo.kind === 'running' || trimmedQuery.length === 0}
          >
            {t('ai.privilege-explainer.demo')}
          </Button>
          {trimmedQuery.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t('ai.privilege-explainer.no-question')}
            </p>
          )}
          {demo.kind === 'desktop-only' && (
            <p
              data-testid="privilege-explainer-result"
              className="rounded border border-border bg-muted px-2 py-1.5 text-xs text-muted-foreground"
            >
              {t('ai.privilege-explainer.desktop-only')}
            </p>
          )}
          {demo.kind === 'result' &&
            (demo.withheldCount > 0 ? (
              <p
                data-testid="privilege-explainer-result"
                className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900"
              >
                {t('ai.privilege-explainer.withheld', {
                  count: demo.withheldCount,
                  name: demo.topWithheldBasename ?? '',
                })}
              </p>
            ) : (
              <p
                data-testid="privilege-explainer-result"
                className="rounded border border-border bg-muted px-2 py-1.5 text-xs text-muted-foreground"
              >
                {t('ai.privilege-explainer.none-withheld')}
              </p>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
