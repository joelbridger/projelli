// Comparison View Component
// Side-by-side comparison of multiple model outputs

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  GitCompare,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { Contradiction, ContradictionAnalysis } from '@/modules/analysis/ContradictionDetector';

interface ModelOutput {
  model: string;
  content: string;
  metadata?: {
    tokens?: number;
    cost?: number;
    latency?: number;
  };
}

interface ComparisonViewProps {
  outputs: ModelOutput[];
  analysis?: ContradictionAnalysis;
  onRequestSynthesis?: () => void;
  className?: string;
}

export function ComparisonView({
  outputs,
  analysis,
  onRequestSynthesis,
  className,
}: ComparisonViewProps) {
  const [expandedContradictions, setExpandedContradictions] = useState<Set<string>>(new Set());

  const toggleContradiction = useCallback((id: string) => {
    setExpandedContradictions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (outputs.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-full text-muted-foreground', className)}>
        <p>No outputs to compare</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <GitCompare className="h-5 w-5" />
          <span className="font-medium">Model Comparison</span>
          <span className="text-xs text-muted-foreground">
            ({outputs.length} outputs)
          </span>
        </div>
        {onRequestSynthesis && (
          <Button size="sm" onClick={onRequestSynthesis}>
            Generate Synthesis
          </Button>
        )}
      </div>

      {/* Agreement Score */}
      {analysis && (
        <div className="px-4 py-2 border-b bg-muted/50">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Agreement:</span>
              <AgreementBadge score={analysis.agreementScore} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Contradictions:</span>
              <span className={cn(
                'text-sm font-medium',
                analysis.contradictions.length > 0 ? 'text-amber-600' : 'text-green-600'
              )}>
                {analysis.contradictions.length}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Side-by-side outputs */}
        <div className="flex-1 overflow-auto">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${outputs.length}, 1fr)` }}>
            {outputs.map((output) => (
              <OutputColumn key={output.model} output={output} />
            ))}
          </div>
        </div>

        {/* Contradictions Panel */}
        {analysis && analysis.contradictions.length > 0 && (
          <div className="border-t max-h-[300px] overflow-auto">
            <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/20 border-b">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="font-medium text-sm">Detected Contradictions</span>
              </div>
            </div>
            <div className="divide-y">
              {analysis.contradictions.map((contradiction) => (
                <ContradictionRow
                  key={contradiction.id}
                  contradiction={contradiction}
                  isExpanded={expandedContradictions.has(contradiction.id)}
                  onToggle={() => toggleContradiction(contradiction.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Key Agreements */}
        {analysis && analysis.keyAgreements.length > 0 && (
          <div className="border-t p-4 bg-green-50 dark:bg-green-950/20">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="font-medium text-sm">Key Agreements</span>
            </div>
            <ul className="text-sm space-y-1">
              {analysis.keyAgreements.map((agreement, i) => (
                <li key={i} className="text-muted-foreground">
                  • {agreement}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

interface OutputColumnProps {
  output: ModelOutput;
}

function OutputColumn({ output }: OutputColumnProps) {
  return (
    <div className="border-r last:border-r-0 flex flex-col">
      {/* Column header */}
      <div className="px-4 py-2 border-b bg-muted/50 sticky top-0">
        <div className="font-medium text-sm">{output.model}</div>
        {output.metadata && (
          <div className="flex gap-3 text-xs text-muted-foreground mt-1">
            {output.metadata.tokens !== undefined && (
              <span>{output.metadata.tokens} tokens</span>
            )}
            {output.metadata.cost !== undefined && (
              <span>${output.metadata.cost.toFixed(4)}</span>
            )}
            {output.metadata.latency !== undefined && (
              <span>{(output.metadata.latency / 1000).toFixed(1)}s</span>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 text-sm whitespace-pre-wrap">
        {output.content}
      </div>
    </div>
  );
}

interface AgreementBadgeProps {
  score: number;
}

function AgreementBadge({ score }: AgreementBadgeProps) {
  const percentage = Math.round(score * 100);

  let color: string;
  let icon: React.ReactNode;

  if (score >= 0.8) {
    color = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    icon = <CheckCircle className="h-3 w-3" />;
  } else if (score >= 0.5) {
    color = 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
    icon = <HelpCircle className="h-3 w-3" />;
  } else {
    color = 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    icon = <AlertTriangle className="h-3 w-3" />;
  }

  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium', color)}>
      {icon}
      {percentage}%
    </span>
  );
}

interface ContradictionRowProps {
  contradiction: Contradiction;
  isExpanded: boolean;
  onToggle: () => void;
}

function ContradictionRow({ contradiction, isExpanded, onToggle }: ContradictionRowProps) {
  const severityColors = {
    minor: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    moderate: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    major: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  };

  return (
    <div className="hover:bg-muted/50">
      <button
        onClick={onToggle}
        className="w-full px-4 py-2 text-left flex items-start gap-2"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 mt-0.5 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(
              'text-xs px-1.5 py-0.5 rounded capitalize',
              severityColors[contradiction.severity]
            )}>
              {contradiction.severity}
            </span>
            <span className="text-xs text-muted-foreground capitalize">
              {contradiction.type}
            </span>
          </div>
          <p className="text-sm mt-1 truncate">{contradiction.explanation}</p>
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-3 ml-6 space-y-3">
          {/* Statement 1 */}
          <div className="rounded border p-3">
            <div className="text-xs text-muted-foreground mb-1">
              {contradiction.statement1.source}
            </div>
            <p className="text-sm">"{contradiction.statement1.text}"</p>
          </div>

          {/* vs indicator */}
          <div className="text-center text-xs text-muted-foreground">vs</div>

          {/* Statement 2 */}
          <div className="rounded border p-3">
            <div className="text-xs text-muted-foreground mb-1">
              {contradiction.statement2.source}
            </div>
            <p className="text-sm">"{contradiction.statement2.text}"</p>
          </div>

          {/* Suggested resolution */}
          {contradiction.suggestedResolution && (
            <div className="rounded bg-blue-50 dark:bg-blue-950/20 p-3">
              <div className="text-xs font-medium text-blue-800 dark:text-blue-200 mb-1">
                Suggested Resolution
              </div>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                {contradiction.suggestedResolution}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ComparisonView;
