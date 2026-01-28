// Synthesis Panel Component
// Displays a synthesized document with source attribution

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  FileText,
  Download,
  Copy,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  AlertTriangle,
  HelpCircle,
  Info,
} from 'lucide-react';
import type { Synthesis, SynthesisSection } from '@/modules/analysis/SynthesisGenerator';

interface SynthesisPanelProps {
  synthesis: Synthesis;
  onDownload?: () => void;
  onCopy?: () => void;
  className?: string;
}

export function SynthesisPanel({
  synthesis,
  onDownload,
  onCopy,
  className,
}: SynthesisPanelProps) {
  const [expandedSections, setExpandedSections] = useState<Set<number>>(
    new Set(synthesis.sections.map((_, i) => i))
  );
  const [showResolutions, setShowResolutions] = useState(false);

  const toggleSection = (index: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          <span className="font-medium">{synthesis.title}</span>
        </div>
        <div className="flex items-center gap-2">
          {onCopy && (
            <Button variant="ghost" size="sm" onClick={onCopy}>
              <Copy className="h-4 w-4 mr-1" />
              Copy
            </Button>
          )}
          {onDownload && (
            <Button variant="ghost" size="sm" onClick={onDownload}>
              <Download className="h-4 w-4 mr-1" />
              Download
            </Button>
          )}
        </div>
      </div>

      {/* Metadata */}
      <div className="px-4 py-2 border-b bg-muted/50 flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Sources:</span>
          <span>{synthesis.sources.join(', ')}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Confidence:</span>
          <ConfidenceBadge confidence={synthesis.confidence} />
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          {new Date(synthesis.generatedAt).toLocaleDateString()}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* Main content */}
        <div className="p-4 border-b">
          <p className="text-sm whitespace-pre-wrap">{synthesis.content}</p>
        </div>

        {/* Sections */}
        <div className="divide-y">
          {synthesis.sections.map((section, index) => (
            <SectionRow
              key={index}
              section={section}
              isExpanded={expandedSections.has(index)}
              onToggle={() => toggleSection(index)}
            />
          ))}
        </div>

        {/* Resolved Contradictions */}
        {synthesis.resolvedContradictions.length > 0 && (
          <div className="border-t">
            <button
              onClick={() => setShowResolutions(!showResolutions)}
              className="w-full px-4 py-3 text-left flex items-center gap-2 hover:bg-muted/50"
            >
              {showResolutions ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="font-medium text-sm">
                Resolved Contradictions ({synthesis.resolvedContradictions.length})
              </span>
            </button>

            {showResolutions && (
              <div className="px-4 pb-4 space-y-3">
                {synthesis.resolvedContradictions.map((rc) => (
                  <div
                    key={rc.contradictionId}
                    className="rounded border p-3 bg-green-50 dark:bg-green-950/20"
                  >
                    <div className="text-xs text-muted-foreground mb-1">
                      {rc.contradictionId}
                    </div>
                    <p className="text-sm font-medium">{rc.resolution}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {rc.rationale}
                    </p>
                    {rc.preferredSource && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Preferred source: {rc.preferredSource}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Unresolved Contradictions */}
        {synthesis.unresolvedContradictions.length > 0 && (
          <div className="border-t p-4 bg-amber-50 dark:bg-amber-950/20">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="font-medium text-sm">
                Unresolved Contradictions
              </span>
            </div>
            <ul className="text-sm space-y-1">
              {synthesis.unresolvedContradictions.map((uc, i) => (
                <li key={i} className="text-muted-foreground">
                  • {uc}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

interface SectionRowProps {
  section: SynthesisSection;
  isExpanded: boolean;
  onToggle: () => void;
}

function SectionRow({ section, isExpanded, onToggle }: SectionRowProps) {
  const agreementColors = {
    high: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    low: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  };

  return (
    <div className="hover:bg-muted/50">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 text-left flex items-start gap-2"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 mt-0.5 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{section.heading}</span>
            <span className={cn(
              'text-xs px-1.5 py-0.5 rounded capitalize',
              agreementColors[section.sourceAgreement]
            )}>
              {section.sourceAgreement} agreement
            </span>
          </div>
          {!isExpanded && (
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {section.content.slice(0, 100)}...
            </p>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 ml-6 space-y-3">
          <p className="text-sm whitespace-pre-wrap">{section.content}</p>

          {section.notes && (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <p>{section.notes}</p>
            </div>
          )}

          {section.citations.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Sources: {section.citations.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ConfidenceBadgeProps {
  confidence: number;
}

function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  const percentage = Math.round(confidence * 100);

  let color: string;
  let icon: React.ReactNode;

  if (confidence >= 0.7) {
    color = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    icon = <CheckCircle className="h-3 w-3" />;
  } else if (confidence >= 0.4) {
    color = 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
    icon = <HelpCircle className="h-3 w-3" />;
  } else {
    color = 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    icon = <AlertTriangle className="h-3 w-3" />;
  }

  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
      color
    )}>
      {icon}
      {percentage}%
    </span>
  );
}

export default SynthesisPanel;
