// Workflow Panel Component
// UI for starting and managing workflows

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Play, Clock, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
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

  const handleStartClick = (template: WorkflowTemplate) => {
    onStartWorkflow(template);
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto flex-1 h-full">
      <div>
        <h3 className="text-sm font-semibold mb-3">Available Workflows</h3>
        <div className="space-y-2">
          {availableWorkflows.map((workflow) => (
            <Card key={workflow.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
              <CardHeader className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm">{workflow.name}</CardTitle>
                    <CardDescription className="text-xs mt-1">
                      {workflow.description}
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleStartClick(workflow)}
                    disabled={currentExecution !== null}
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
      </div>

      {currentExecution && (
        <div>
          <h3 className="text-sm font-semibold mb-3">Current Execution</h3>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                <span className="text-sm font-medium">
                  {currentExecution.template.name}
                </span>
              </div>
              <div className="space-y-1">
                {currentExecution.template.steps.map((step, index) => (
                  <div
                    key={step.id}
                    className="flex items-center gap-2 text-xs"
                  >
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
