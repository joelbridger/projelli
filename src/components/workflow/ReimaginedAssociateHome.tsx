/**
 * ReimaginedAssociateHome — full-page litigation associate surface.
 *
 * Wraps the existing WorkflowPanel full-width so it gets the same full-page
 * treatment as other reimagined tabs. No workflow logic is rebuilt here.
 */

import { ListChecks } from 'lucide-react';
import { WorkflowPanel } from '@/components/workflow/WorkflowPanel';
import type { WorkflowTemplate, WorkflowExecution, RunRecord, WorkflowChain } from '@/types/workflow';

interface ReimaginedAssociateHomeProps {
  onStartWorkflow: (template: WorkflowTemplate) => void;
  currentExecution: WorkflowExecution | null;
  runHistory: RunRecord[];
  providerError?: 'needs-provider' | 'ollama-unreachable' | null;
  onOpenSettings?: () => void;
  onFocusExecutionTab?: () => void;
  onRunChain?: (chain: WorkflowChain) => void;
}

export function ReimaginedAssociateHome({
  onStartWorkflow,
  currentExecution,
  runHistory,
  providerError,
  onOpenSettings,
  onFocusExecutionTab,
  onRunChain,
}: ReimaginedAssociateHomeProps) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-background)',
        overflow: 'hidden',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Page header */}
      <div
        style={{
          padding: '14px 20px 12px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <ListChecks
          style={{
            width: 18,
            height: 18,
            color: 'var(--kp-navy)',
            strokeWidth: 1.75,
            flex: 'none',
          }}
        />
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.13em',
              textTransform: 'uppercase',
              color: 'var(--color-muted-foreground)',
              marginBottom: 2,
            }}
          >
            ASSOCIATE
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 800,
              color: 'var(--kp-navy)',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
            }}
          >
            Litigation Associate
          </h1>
        </div>
      </div>

      {/* Body: WorkflowPanel full-width */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <WorkflowPanel
          onStartWorkflow={onStartWorkflow}
          currentExecution={currentExecution}
          runHistory={runHistory}
          heading="Litigation Associate"
          {...(providerError !== undefined && { providerError })}
          {...(onOpenSettings !== undefined && { onOpenSettings })}
          {...(onFocusExecutionTab !== undefined && { onFocusExecutionTab })}
          {...(onRunChain !== undefined && { onRunChain })}
        />
      </div>
    </div>
  );
}
