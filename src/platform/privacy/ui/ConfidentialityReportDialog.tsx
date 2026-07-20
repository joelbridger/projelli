/**
 * ConfidentialityReportDialog — printable per-matter confidentiality report.
 *
 * A lawyer can print this and keep it in the client file. It shows exactly
 * which AI calls were made for a matter, which mode each call used, and an
 * honest attestation sentence about where the data went.
 *
 * Uses the exact same hidden-iframe print pattern as DataMapDialog.
 */
/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useCallback } from 'react';
import { Printer, X, ShieldCheck } from 'lucide-react';
import type { ConfidentialityReport } from '@/platform/privacy/confidentialityReport';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { useEntityLabelEnglish } from '@/platform/hooks/useEntityLabel';
import { brandText } from '@/config/brandText';
import { BRAND } from '@/config/brand';

export interface ConfidentialityReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: ConfidentialityReport;
}

const PRINTABLE_ID = 'lantern-confidentiality-report-printable';

function modeBadgeStyle(mode: string): React.CSSProperties {
  if (mode === 'local-only') {
    return { background: '#d1fae5', color: '#065f46', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 };
  }
  if (mode === 'assured') {
    return { background: '#e0e7ff', color: '#3730a3', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 };
  }
  // direct
  return { background: '#dbeafe', color: '#1d4ed8', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 };
}

function modeLabel(mode: string): string {
  if (mode === 'local-only') return 'Local only';
  if (mode === 'assured') return 'Assured';
  return 'Direct (BYOK)';
}

export function ConfidentialityReportDialog({ open, onOpenChange, report }: ConfidentialityReportDialogProps) {
  // Fixed-English escape hatch: the sentences using entityLabel below are
  // still hardcoded English (see the cleanup2 handoff), so the noun stays
  // English too rather than mixing languages.
  const entityLabel = useEntityLabelEnglish();
  const handlePrint = useCallback(() => {
    const node = document.getElementById(PRINTABLE_ID);
    if (!node) {
      window.print();
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      document.body.removeChild(iframe);
      window.print();
      return;
    }

    doc.title = brandText(`Confidentiality Report: ${report.matterName} (${BRAND.name})`);

    const style = doc.createElement('style');
    style.textContent = [
      'body { font: 14px/1.6 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; max-width: 720px; margin: 40px auto; padding: 0 24px; }',
      'h1 { font-size: 20px; margin: 0 0 4px; }',
      '.sub { color: #555; margin: 0 0 4px; font-size: 13px; }',
      '.attestation { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px 16px; margin: 18px 0; }',
      '.attestation p { margin: 0; font-size: 14px; line-height: 1.6; }',
      'table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }',
      'th { text-align: left; padding: 8px 10px; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-weight: 600; }',
      'td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }',
      '.badge { border-radius: 4px; padding: 2px 7px; font-size: 11px; font-weight: 600; }',
      '.badge-local { background: #d1fae5; color: #065f46; }',
      '.badge-direct { background: #dbeafe; color: #1d4ed8; }',
      '.badge-assured { background: #e0e7ff; color: #3730a3; }',
      '.foot { margin-top: 28px; color: #777; font-size: 12px; line-height: 1.5; border-top: 1px solid #e2e8f0; padding-top: 14px; }',
      'svg { display: none; }',
    ].join('\n');
    doc.head.appendChild(style);
    doc.body.appendChild(node.cloneNode(true));

    const cleanup = () => {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 500);
    };
    win.addEventListener('afterprint', cleanup, { once: true });

    setTimeout(() => {
      win.focus();
      win.print();
      setTimeout(cleanup, 1000);
    }, 100);
  }, [report.matterName]);

  const generatedDate = (() => {
    try {
      return new Date(report.generatedAt).toLocaleString();
    } catch {
      return report.generatedAt;
    }
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="confidentiality-report"
        className="max-w-2xl w-[92vw] h-[85vh] max-h-[840px] p-0 flex flex-col overflow-hidden [&>button]:hidden"
      >
        <DialogTitle className="sr-only">
          Confidentiality Report for {report.matterName}
        </DialogTitle>
        <DialogDescription className="sr-only">
          A printable record of AI activity for this {entityLabel.one} and where the data went.
        </DialogDescription>

        {/* Header */}
        <div className="shrink-0 border-b px-6 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" />
            <div>
              <h2 className="text-base font-semibold truncate">
                Confidentiality Report
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {report.matterName} &bull; {generatedDate}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              data-testid="confidentiality-report-print"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handlePrint}
            >
              <Printer className="h-3.5 w-3.5" />
              Print / Save PDF
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => { onOpenChange(false); }}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div id={PRINTABLE_ID}>
            <h1 className="text-lg font-semibold mb-1">
              Confidentiality Report
            </h1>
            <p className="sub text-sm text-muted-foreground mb-1">
              {entityLabel.One}: <strong>{report.matterName}</strong>
            </p>
            <p className="sub text-sm text-muted-foreground mb-4">
              Generated: {generatedDate} &bull; {report.totalCalls} AI {report.totalCalls === 1 ? 'call' : 'calls'} recorded
            </p>

            {/* Attestation */}
            <div
              className="attestation rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3.5 mb-5"
              data-testid="confidentiality-attestation"
            >
              <p className="text-sm leading-relaxed text-emerald-900">
                {report.attestation}
              </p>
            </div>

            {/* Summary by mode */}
            {report.totalCalls > 0 && (
              <div className="mb-5">
                <h2 className="text-sm font-semibold mb-2">Summary by mode</h2>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(report.byMode).map(([mode, count]) => (
                    <span key={mode} style={modeBadgeStyle(mode)}>
                      {modeLabel(mode)}: {count} {count === 1 ? 'call' : 'calls'}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Per-call table */}
            {report.totalCalls > 0 ? (
              <div>
                <h2 className="text-sm font-semibold mb-2">All AI calls for this {entityLabel.one}</h2>
                <div className="overflow-x-auto">
                  <table
                    className="w-full text-xs border-collapse"
                    data-testid="confidentiality-call-table"
                  >
                    <thead>
                      <tr className="border-b border-border/60 bg-muted/30">
                        <th className="text-left py-2 px-3 font-semibold text-muted-foreground">When</th>
                        <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Mode</th>
                        <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Model</th>
                        <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Provider</th>
                        <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Data left machine?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.calls.map((call, i) => (
                        <tr key={i} className="border-b border-border/40 last:border-b-0">
                          <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                            {(() => { try { return new Date(call.at).toLocaleString(); } catch { return call.at; } })()}
                          </td>
                          <td className="py-2 px-3">
                            <span style={modeBadgeStyle(call.mode)}>{modeLabel(call.mode)}</span>
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">{call.model}</td>
                          <td className="py-2 px-3 text-muted-foreground">{call.provider}</td>
                          <td className="py-2 px-3">
                            {call.dataLeaves ? (
                              <span className="text-amber-700 font-medium">Yes</span>
                            ) : (
                              <span className="text-emerald-700 font-medium">No</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No AI calls have been recorded for this {entityLabel.one} yet.</p>
            )}

            {/* Footer note */}
            <div className="foot mt-6 text-xs text-muted-foreground border-t border-border pt-4 leading-relaxed">
              {brandText(`This report reflects the architecture-level data flow recorded by ${BRAND.name}. It is based on audit log entries from your local machine. ${BRAND.name} holds no copies of your prompts. For questions about your AI provider's data handling, refer to their published data processing policies. This report is not professional or compliance advice and does not certify compliance with any specific regulation.`)}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ConfidentialityReportDialog;
