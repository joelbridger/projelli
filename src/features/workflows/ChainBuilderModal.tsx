// Chain Builder Modal (M7)
//
// A list-of-steps UI for composing a WorkflowChain. Deliberately simple:
//   - Add step, pick template, optionally map a prior step's named output
//     into one of this template's named inputs.
//   - Save stores the chain via `saveChain` so the picker can load it later.
//   - Run dispatches the chain via the provided onRun callback; the caller
//     owns the engine lifecycle (provider, fileOps, progress toasts).
//
// We intentionally keep this to a single component file so it's easy to
// read and delete — the v1.5 spec explicitly rules out a drag-drop node
// graph editor.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Plus, Trash2, Play } from 'lucide-react';
import type {
  WorkflowChain,
  WorkflowChainStep,
  WorkflowTemplate,
} from '@/platform/types/workflow';
import { emptyChain } from '@/features/workflows/engine/WorkflowChainEngine';
import { saveChain } from '@/features/workflows/engine/workflowChains';

interface ChainBuilderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: WorkflowTemplate[];
  /** Seed chain — omit to start a fresh empty chain. */
  initial?: WorkflowChain | undefined;
  /** Invoked after save; parent typically refreshes its chain list. */
  onSaved?: ((chain: WorkflowChain) => void) | undefined;
  /** Invoked on "Run now"; parent owns the engine wiring. */
  onRun?: ((chain: WorkflowChain) => void) | undefined;
}

export function ChainBuilderModal({
  open,
  onOpenChange,
  templates,
  initial,
  onSaved,
  onRun,
}: ChainBuilderModalProps) {
  const { t } = useTranslation();
  const [chain, setChain] = useState<WorkflowChain>(() =>
    initial ?? emptyChain('Untitled chain')
  );

  // Reset whenever the dialog is reopened with a fresh `initial`.
  useEffect(() => {
    if (open) {
      setChain(initial ?? emptyChain('Untitled chain'));
    }
  }, [open, initial]);

  const templatesById = useMemo(() => {
    const m = new Map<string, WorkflowTemplate>();
    for (const t of templates) m.set(t.id, t);
    return m;
  }, [templates]);

  const addStep = () => {
    const first = templates[0];
    if (!first) return;
    const step: WorkflowChainStep = { templateId: first.id, inputMap: [] };
    setChain((c) => ({ ...c, steps: [...c.steps, step] }));
  };

  const removeStep = (idx: number) => {
    setChain((c) => ({
      ...c,
      steps: c.steps.filter((_, i) => i !== idx),
    }));
  };

  const updateStep = (idx: number, patch: Partial<WorkflowChainStep>) => {
    setChain((c) => ({
      ...c,
      steps: c.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }));
  };

  const handleSave = () => {
    const saved = saveChain(chain);
    onSaved?.(saved);
    onOpenChange(false);
  };

  const handleRun = () => {
    const saved = saveChain(chain);
    onRun?.(saved);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="chain-builder-modal"
        className="max-w-3xl w-[90vw] max-h-[90vh] overflow-hidden flex flex-col"
      >
        <DialogHeader>
          <DialogTitle>{t('workflow.chain-builder.title')}</DialogTitle>
          <DialogDescription>
            {t('workflow.chain-builder.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          <div>
            <label className="text-xs font-medium block mb-1" htmlFor="chain-name">
              Chain name
            </label>
            <Input
              id="chain-name"
              data-testid="chain-name"
              value={chain.name}
              onChange={(e) => setChain((c) => ({ ...c, name: e.target.value }))}
              placeholder="e.g. Research → Pricing"
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-2">
            {chain.steps.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center border rounded">
                {t('workflow.chain-builder.no-steps')}
              </p>
            )}
            {chain.steps.map((step, idx) => (
              <ChainStepRow
                key={idx}
                idx={idx}
                step={step}
                templates={templates}
                priorSteps={chain.steps.slice(0, idx)}
                templatesById={templatesById}
                onChange={(patch) => updateStep(idx, patch)}
                onRemove={() => removeStep(idx)}
              />
            ))}
          </div>

          <Button
            data-testid="chain-add-step"
            size="sm"
            variant="outline"
            onClick={addStep}
            disabled={templates.length === 0}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add step
          </Button>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="chain-save"
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={chain.steps.length === 0}
          >
            Save chain
          </Button>
          <Button
            data-testid="chain-run"
            size="sm"
            onClick={handleRun}
            disabled={chain.steps.length === 0 || !onRun}
          >
            <Play className="h-3.5 w-3.5 mr-1.5" />
            Save & run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ChainStepRowProps {
  idx: number;
  step: WorkflowChainStep;
  templates: WorkflowTemplate[];
  priorSteps: WorkflowChainStep[];
  templatesById: Map<string, WorkflowTemplate>;
  onChange: (patch: Partial<WorkflowChainStep>) => void;
  onRemove: () => void;
}

function ChainStepRow({
  idx,
  step,
  templates,
  priorSteps,
  templatesById,
  onChange,
  onRemove,
}: ChainStepRowProps) {
  const { t } = useTranslation();
  const template = templatesById.get(step.templateId);
  const namedInputs = template?.namedInputs ?? [];

  // All the (stepIndex, outputId) pairs available from prior steps.
  const priorOutputs = priorSteps.flatMap((ps, stepIndex) => {
    const tpl = templatesById.get(ps.templateId);
    return (tpl?.namedOutputs ?? []).map((o) => ({
      stepIndex,
      outputId: o.id,
      label: `Step ${stepIndex + 1}: ${o.name}`,
    }));
  });

  return (
    <div
      data-testid={`chain-step-${idx}`}
      className="border rounded p-3 space-y-2 bg-muted/20"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground w-14">
          Step {idx + 1}
        </span>
        <select
          data-testid={`chain-template-picker-${idx}`}
          aria-label={`Template for step ${idx + 1}`}
          className="flex-1 h-8 rounded-md border bg-background px-2 text-sm"
          value={step.templateId}
          onChange={(e) => onChange({ templateId: e.target.value, inputMap: [] })}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 text-destructive"
          onClick={onRemove}
          aria-label={`Remove step ${idx + 1}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {idx > 0 && namedInputs.length > 0 && priorOutputs.length > 0 && (
        <div
          data-testid={`chain-output-to-input-map-${idx}`}
          className="text-xs space-y-1 ml-16"
        >
          <p className="text-muted-foreground">{t('workflow.chain-builder.map-outputs')}</p>
          {namedInputs.map((input) => {
            const current = step.inputMap?.find((m) => m.toInputId === input.id);
            const recommended = priorOutputs.filter((po) =>
              input.acceptsOutputFrom?.includes(po.outputId)
            );
            const others = priorOutputs.filter(
              (po) => !input.acceptsOutputFrom?.includes(po.outputId)
            );
            return (
              <div key={input.id} className="flex items-center gap-2">
                <span className="w-32 shrink-0">{input.name}</span>
                <span className="text-muted-foreground">←</span>
                <select
                  aria-label={`Map input ${input.name}`}
                  className="flex-1 h-7 rounded border bg-background px-1.5 text-xs"
                  value={
                    current
                      ? `${current.fromStepIndex}:${current.fromOutputId}`
                      : ''
                  }
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (!raw) {
                      onChange({
                        inputMap: (step.inputMap ?? []).filter(
                          (m) => m.toInputId !== input.id
                        ),
                      });
                      return;
                    }
                    const [fi, oid] = raw.split(':');
                    const fromStepIndex = parseInt(fi ?? '0', 10);
                    const fromOutputId = oid ?? '';
                    const rest = (step.inputMap ?? []).filter(
                      (m) => m.toInputId !== input.id
                    );
                    onChange({
                      inputMap: [
                        ...rest,
                        { fromStepIndex, fromOutputId, toInputId: input.id },
                      ],
                    });
                  }}
                >
                  <option value="">(none)</option>
                  {recommended.length > 0 && (
                    <optgroup label="Recommended">
                      {recommended.map((po) => (
                        <option
                          key={`${po.stepIndex}:${po.outputId}`}
                          value={`${po.stepIndex}:${po.outputId}`}
                        >
                          ✓ {po.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {others.length > 0 && (
                    <optgroup label="Manual mapping">
                      {others.map((po) => (
                        <option
                          key={`${po.stepIndex}:${po.outputId}`}
                          value={`${po.stepIndex}:${po.outputId}`}
                        >
                          {po.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ChainBuilderModal;
