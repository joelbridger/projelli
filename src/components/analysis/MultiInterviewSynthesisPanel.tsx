// Multi-Interview Synthesis Panel (M8)
//
// Drag-drop zone + paste box + structured results renderer. The actual
// AI work is delegated to `runMultiInterviewSynthesis()` in the
// MultiInterviewSynthesis module; this component just collects transcripts
// and renders the result nicely.
//
// Intentionally self-contained — the parent passes a Provider and an
// optional onSaveMarkdown callback. No direct workspace or tab coupling.

import { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type { Provider } from '@/modules/models/Provider';
import {
  runMultiInterviewSynthesis,
  splitPastedTranscripts,
  type MultiInterviewSynthesisResult,
  type TranscriptInput,
} from '@/modules/analysis/MultiInterviewSynthesis';

export interface MultiInterviewSynthesisPanelProps {
  provider: Provider;
  /** Optional callback to save the rendered markdown into the workspace. */
  onSaveMarkdown?: (markdown: string, filename: string) => void;
  /** Seed transcripts — e.g. from an upstream UserInterviews chain step. */
  seedTranscripts?: TranscriptInput[];
  className?: string;
}

export function MultiInterviewSynthesisPanel({
  provider,
  onSaveMarkdown,
  seedTranscripts = [],
  className,
}: MultiInterviewSynthesisPanelProps) {
  const [transcripts, setTranscripts] = useState<TranscriptInput[]>(seedTranscripts);
  const [pasted, setPasted] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<MultiInterviewSynthesisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = useCallback(async (files: File[]) => {
    const next: TranscriptInput[] = [];
    for (const f of files) {
      if (!/\.(md|txt)$/i.test(f.name)) continue;
      const content = await f.text();
      next.push({ source: f.name, content });
    }
    setTranscripts((prev) => [...prev, ...next]);
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      await addFiles(files);
    },
    [addFiles]
  );

  const importPasted = useCallback(() => {
    const parsed = splitPastedTranscripts(pasted);
    if (parsed.length === 0) return;
    setTranscripts((prev) => [...prev, ...parsed]);
    setPasted('');
  }, [pasted]);

  const removeTranscript = (idx: number) => {
    setTranscripts((prev) => prev.filter((_, i) => i !== idx));
  };

  const canRun = transcripts.length >= 1 && !isRunning;

  const runSynthesis = async () => {
    setIsRunning(true);
    setError(null);
    setResult(null);
    try {
      const { phaseB } = await runMultiInterviewSynthesis(provider, transcripts);
      setResult(phaseB);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  };

  const markdown = useMemo(
    () => (result ? renderSynthesisMarkdown(result) : ''),
    [result]
  );

  return (
    <div data-testid="multi-interview-synthesis-panel" className={className}>
      <div className="p-4 space-y-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            Multi-interview synthesis
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Drop 3+ transcripts (or paste them below) to produce themes,
            contradictions, jobs-to-be-done, and a priority-ranked feature
            list.
          </p>
        </div>

        {/* Drop zone */}
        <div
          data-testid="multi-interview-drop-zone"
          className={
            'border-2 border-dashed rounded p-6 text-center text-sm transition-colors ' +
            (dragActive ? 'border-amber-500 bg-amber-50' : 'border-muted-foreground/30')
          }
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
        >
          <Upload className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
          Drop .md or .txt transcripts here
          <div className="mt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose files
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt"
              multiple
              className="hidden"
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </div>
        </div>

        {/* Paste zone */}
        <div className="space-y-1">
          <label className="text-xs font-medium" htmlFor="multi-paste">
            Or paste transcripts (separated by `---`)
          </label>
          <Textarea
            id="multi-paste"
            data-testid="multi-interview-paste"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={5}
            placeholder="Transcript 1...\n---\nTranscript 2...\n---\nTranscript 3..."
            className="text-xs font-mono"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={importPasted}
              disabled={pasted.trim().length === 0}
            >
              Import pasted
            </Button>
          </div>
        </div>

        {/* Transcript list */}
        {transcripts.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              {transcripts.length} transcript{transcripts.length === 1 ? '' : 's'} ready
            </p>
            {transcripts.map((t, i) => (
              <div
                key={i}
                data-testid={`multi-interview-item-${i}`}
                className="flex items-center gap-2 text-xs border rounded px-2 py-1.5"
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 truncate">{t.source}</span>
                <span className="text-muted-foreground">{t.content.length} chars</span>
                <button
                  aria-label={`Remove ${t.source}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => removeTranscript(i)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Run button */}
        <div className="flex justify-end">
          <Button
            data-testid="multi-interview-run"
            size="sm"
            onClick={runSynthesis}
            disabled={!canRun}
          >
            {isRunning ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Synthesizing…
              </>
            ) : (
              <>Run synthesis</>
            )}
          </Button>
        </div>

        {error && (
          <Card className="border-red-500/30">
            <CardContent className="py-3 text-sm text-red-600">{error}</CardContent>
          </Card>
        )}

        {/* Result */}
        {result && (
          <SynthesisResult
            result={result}
            markdown={markdown}
            onSaveMarkdown={onSaveMarkdown}
          />
        )}
      </div>
    </div>
  );
}

interface SynthesisResultProps {
  result: MultiInterviewSynthesisResult;
  markdown: string;
  onSaveMarkdown?: ((markdown: string, filename: string) => void) | undefined;
}

function SynthesisResult({ result, markdown, onSaveMarkdown }: SynthesisResultProps) {
  const [openTheme, setOpenTheme] = useState<Set<number>>(new Set([0]));
  const toggle = (i: number) => {
    setOpenTheme((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };
  return (
    <div data-testid="multi-interview-synthesis-result" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Synthesis</h3>
        {onSaveMarkdown && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSaveMarkdown(markdown, 'INTERVIEW_SYNTHESIS.md')}
          >
            Save as INTERVIEW_SYNTHESIS.md
          </Button>
        )}
      </div>

      {/* Themes (collapsible) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Themes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {result.themes.map((theme, i) => (
            <div
              key={i}
              data-testid={`multi-interview-theme-${i}`}
              className="border rounded"
            >
              <button
                className="flex items-center w-full text-left px-2 py-1.5 text-sm"
                onClick={() => toggle(i)}
              >
                {openTheme.has(i) ? (
                  <ChevronDown className="h-3.5 w-3.5 mr-1" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 mr-1" />
                )}
                <span className="flex-1 font-medium">{theme.name}</span>
                <span className="text-xs text-muted-foreground">
                  ×{theme.frequency}
                </span>
              </button>
              {openTheme.has(i) && (
                <ul className="px-4 pb-2 text-xs space-y-1 text-muted-foreground">
                  {theme.quotes.map((q, qi) => (
                    <li key={qi}>"{q}"</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Killer quotes */}
      {result.killer_quotes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Killer quotes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm space-y-1">
              {result.killer_quotes.map((q, i) => (
                <li key={i} className="italic">"{q}"</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Contradictions — amber highlighted */}
      {result.contradictions.length > 0 && (
        <Card className="border-amber-500/50 bg-amber-50/40 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Contradictions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.contradictions.map((c, i) => (
              <div
                key={i}
                data-testid={`multi-interview-contradiction-${i}`}
                className="text-xs border rounded p-2 bg-background/60"
              >
                <p><strong>A:</strong> "{c.statement_a}"</p>
                <p><strong>B:</strong> "{c.statement_b}"</p>
                <p className="text-muted-foreground mt-1">
                  Sources: {c.sources.join(', ')}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* JTBD table */}
      {result.jtbd_frameworks.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Jobs to be done</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="p-1">Job</th>
                  <th className="p-1">Current solution</th>
                  <th className="p-1">Friction</th>
                </tr>
              </thead>
              <tbody>
                {result.jtbd_frameworks.map((j, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-1">{j.job}</td>
                    <td className="p-1">{j.current_solution}</td>
                    <td className="p-1">{j.friction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Priority features */}
      {result.priority_ranked_features.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Priority features</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm space-y-1">
              {result.priority_ranked_features.map((f, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="flex-1">{f.feature}</span>
                  <span
                    className={
                      'text-xs px-1.5 py-0.5 rounded ' +
                      (f.urgency === 'high'
                        ? 'bg-red-100 text-red-700'
                        : f.urgency === 'medium'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-muted text-muted-foreground')
                    }
                  >
                    {f.urgency}
                  </span>
                  <span className="text-xs text-muted-foreground">×{f.frequency}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Render a synthesis result as Markdown — shared with tests so the
 * rendering is deterministic.
 */
export function renderSynthesisMarkdown(result: MultiInterviewSynthesisResult): string {
  const lines: string[] = [];
  lines.push('# Customer Interview Synthesis', '');
  lines.push('## Themes', '');
  for (const t of result.themes) {
    lines.push(`### ${t.name} (×${t.frequency})`);
    for (const q of t.quotes) lines.push(`- "${q}"`);
    lines.push('');
  }
  if (result.killer_quotes.length > 0) {
    lines.push('## Killer Quotes', '');
    for (const q of result.killer_quotes) lines.push(`- "${q}"`);
    lines.push('');
  }
  if (result.contradictions.length > 0) {
    lines.push('## Contradictions', '');
    for (const c of result.contradictions) {
      lines.push(`- **A**: "${c.statement_a}"`);
      lines.push(`  **B**: "${c.statement_b}"`);
      lines.push(`  _Sources: ${c.sources.join(', ')}_`);
    }
    lines.push('');
  }
  if (result.jtbd_frameworks.length > 0) {
    lines.push('## Jobs to be Done', '');
    lines.push('| Job | Current solution | Friction |');
    lines.push('|-----|-----------------|----------|');
    for (const j of result.jtbd_frameworks) {
      lines.push(`| ${j.job} | ${j.current_solution} | ${j.friction} |`);
    }
    lines.push('');
  }
  if (result.priority_ranked_features.length > 0) {
    lines.push('## Priority Features', '');
    for (const f of result.priority_ranked_features) {
      lines.push(`- **${f.feature}** (${f.urgency}, ×${f.frequency})`);
      for (const q of f.supporting_quotes) lines.push(`  - "${q}"`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export default MultiInterviewSynthesisPanel;
