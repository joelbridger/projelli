// Workflow Panel Component
// UI for starting and managing workflows
//
// Wave 3 UX-09 changes:
//   - Outer container uses `h-full flex flex-col` so the list region fills all
//     available sidebar height (the old panel was a single scroll body that
//     got squeezed to ~131px on short sidebars).
//   - Added a "Open full view" button in the header that opens a Radix Dialog
//     showing every workflow in a 3-column grid with a live search/filter.
//     The modal has a real <DialogTitle> for a11y (no repeat of UX-02).

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Play, Clock, CheckCircle, AlertCircle, Loader2, Maximize2, Search } from 'lucide-react';
import type { WorkflowTemplate, WorkflowExecution, RunRecord } from '@/types/workflow';
import { allWorkflows } from '@/modules/workflow';

// Available workflows
const availableWorkflows: WorkflowTemplate[] = allWorkflows;

interface WorkflowPanelProps {
  onStartWorkflow: (template: WorkflowTemplate) => void;
  currentExecution: WorkflowExecution | null;
  runHistory: RunRecord[];
}

export function WorkflowPanel({
  onStartWorkflow,
  currentExecution,
  runHistory,
}: WorkflowPanelProps) {
  const [showFullView, setShowFullView] = useState(false);

  const handleStartClick = (template: WorkflowTemplate) => {
    onStartWorkflow(template);
  };

  const startFromModal = (template: WorkflowTemplate) => {
    onStartWorkflow(template);
    setShowFullView(false);
  };

  return (
    <div
      data-testid="workflows-panel"
      className="h-full flex flex-col overflow-hidden"
    >
      {/* Header - fixed */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
        <h3 className="text-sm font-semibold">Available Workflows</h3>
        <Button
          data-testid="workflows-open-full-view"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          onClick={() => setShowFullView(true)}
          title="Open workflows in a full-screen browser"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Open full view
        </Button>
      </div>

      {/* Scrollable list region — takes all remaining sidebar height */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
        <div className="space-y-2">
          {availableWorkflows.map((workflow) => (
            <Card
              key={workflow.id}
              data-testid={`workflow-card-${workflow.id}`}
              className="cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <CardHeader className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-sm truncate">{workflow.name}</CardTitle>
                    <CardDescription className="text-xs mt-1 line-clamp-2">
                      {workflow.description}
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => handleStartClick(workflow)}
                    disabled={currentExecution !== null}
                    aria-label={`Start workflow: ${workflow.name}`}
                    title={`Start workflow: ${workflow.name}`}
                  >
                    {currentExecution?.template.id === workflow.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>

        {currentExecution && (
          <div>
            <h3 className="text-sm font-semibold mb-3">Current Execution</h3>
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  <span className="text-sm font-medium">{currentExecution.template.name}</span>
                </div>
                <div className="space-y-1">
                  {currentExecution.template.steps.map((step, index) => (
                    <div key={step.id} className="flex items-center gap-2 text-xs">
                      {index < currentExecution.currentStepIndex ? (
                        <CheckCircle className="h-3 w-3 text-green-500" />
                      ) : index === currentExecution.currentStepIndex ? (
                        <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                      ) : (
                        <Clock className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span
                        className={
                          index === currentExecution.currentStepIndex
                            ? 'font-medium'
                            : 'text-muted-foreground'
                        }
                      >
                        {step.name}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {runHistory.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3">Run History</h3>
            <div className="space-y-2">
              {runHistory.slice(0, 5).map((run) => (
                <Card key={run.run_id}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {run.status === 'completed' ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : run.status === 'failed' ? (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <Clock className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm">{run.workflow}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(run.start_time)}
                      </span>
                    </div>
                    {run.status === 'failed' && run.error && (
                      <p className="text-xs text-red-500 mt-1">{run.error}</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Full-view modal (UX-09) */}
      <WorkflowsFullViewModal
        open={showFullView}
        onOpenChange={setShowFullView}
        currentExecution={currentExecution}
        onStartWorkflow={startFromModal}
      />
    </div>
  );
}

interface WorkflowsFullViewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentExecution: WorkflowExecution | null;
  onStartWorkflow: (template: WorkflowTemplate) => void;
}

function WorkflowsFullViewModal({
  open,
  onOpenChange,
  currentExecution,
  onStartWorkflow,
}: WorkflowsFullViewModalProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableWorkflows;
    return availableWorkflows.filter((w) => {
      const hay = `${w.name} ${w.description}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="workflows-modal"
        className="max-w-5xl w-[90vw] max-h-[90vh] overflow-hidden flex flex-col p-0"
      >
        <DialogHeader className="px-6 pt-6 pb-3 border-b shrink-0">
          <DialogTitle>All workflows</DialogTitle>
          <DialogDescription>
            Pre-built AI workflows for founders. Pick one to start a guided conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-3 border-b shrink-0">
          <div className="flex items-center gap-2 border rounded-md px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Input
              data-testid="workflows-modal-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search workflows..."
              className="border-0 h-6 px-0 focus-visible:ring-0 text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {filtered.length === 0 ? (
            <p
              data-testid="workflows-modal-empty"
              className="text-sm text-muted-foreground text-center py-8"
            >
              No workflows match "{query}".
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((workflow) => (
                <Card
                  key={workflow.id}
                  data-testid={`workflow-modal-card-${workflow.id}`}
                  className="flex flex-col"
                >
                  <CardHeader className="p-4 pb-3 flex-1">
                    <CardTitle className="text-sm leading-snug">{workflow.name}</CardTitle>
                    <CardDescription className="text-xs mt-2 line-clamp-4">
                      {workflow.description}
                    </CardDescription>
                  </CardHeader>
                  <div className="px-4 pb-4">
                    <Button
                      size="sm"
                      className="w-full h-8"
                      onClick={() => onStartWorkflow(workflow)}
                      disabled={currentExecution !== null}
                    >
                      {currentExecution?.template.id === workflow.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Start
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return `${Math.floor(diffMins / 1440)}d ago`;
}

export default WorkflowPanel;
