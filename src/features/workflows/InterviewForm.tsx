// Interview Form Component
// Collects answers to workflow interview questions

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import type { InterviewQuestion } from '@/platform/types/workflow';
import type { Matter } from '@/platform/types/matter';
import { cn } from '@/lib/utils';
import { matterLabel } from '@/platform/rag/matterResolver';
import {
  readSelectionOperationDecision,
  useSelectionOperationDecision,
} from '@/platform/client-context';

const INTERVIEW_SELECTION_REQUEST = {
  operationClass: 'matter-scoped',
  allowAllMatters: false,
  requireFollowerAgreement: true,
} as const;

interface InterviewFormProps {
  questions: InterviewQuestion[];
  onSubmit: (answers: Record<string, string>) => void;
  onCancel?: () => void;
  isSubmitting?: boolean;
}

export function InterviewForm({
  questions,
  onSubmit,
  onCancel,
  isSubmitting = false,
}: InterviewFormProps) {
  const { t } = useTranslation();
  const selection = useSelectionOperationDecision(INTERVIEW_SELECTION_REQUEST);
  const activeMatter = selection.kind === 'matter' ? selection.matter : null;
  const initialMatterIdRef = useRef(activeMatter?.id ?? null);
  const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [highlightedQuestionId, setHighlightedQuestionId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    buildInitialAnswers(questions, activeMatter),
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectionError, setSelectionError] = useState<string | null>(
    selection.kind === 'refused' ? selection.message : null,
  );

  const handleChange = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    // Clear error when user types
    if (errors[questionId]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const currentSelection = readSelectionOperationDecision({
      ...INTERVIEW_SELECTION_REQUEST,
      ...(initialMatterIdRef.current
        ? { expectedScope: { kind: 'matter' as const, matterId: initialMatterIdRef.current } }
        : {}),
    });
    if (currentSelection.kind !== 'matter') {
      setSelectionError(
        currentSelection.kind === 'refused'
          ? currentSelection.message
          : 'Choose one client before running this workflow.',
      );
      return;
    }
    setSelectionError(null);

    // Validate required fields
    const newErrors: Record<string, string> = {};
    for (const q of questions) {
      if (q.required && !answers[q.id]?.trim()) {
        newErrors[q.id] = t('workflow.interview.required');
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      const firstMissingId = questions.find((q) => newErrors[q.id])?.id;
      if (firstMissingId) {
        setHighlightedQuestionId(firstMissingId);
        requestAnimationFrame(() => {
          fieldRefs.current[firstMissingId]?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        });
      }
      return;
    }

    onSubmit(answers);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {questions.map((question) => (
        <div
          key={question.id}
          ref={(node) => { fieldRefs.current[question.id] = node; }}
          data-testid={`workflow-question-${question.id}`}
          className={cn(
            'border-b border-amber-200/70 pb-3 last:border-b-0 last:pb-0',
            highlightedQuestionId === question.id &&
              'rounded-md bg-amber-100/70 p-2 ring-2 ring-amber-400 transition-colors'
          )}
        >
          <div className="space-y-1">
            <label className="block text-sm font-medium text-foreground">
              {question.question}
              {question.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            {question.description && (
              <p className="text-xs text-muted-foreground">
                {question.description}
              </p>
            )}
          </div>
          <div className="mt-2">
            {question.type === 'text' && (
              <Input
                type="text"
                value={answers[question.id] ?? ''}
                onChange={(e) => handleChange(question.id, e.target.value)}
                onFocus={() => {
                  if (highlightedQuestionId === question.id) setHighlightedQuestionId(null);
                }}
                placeholder={question.placeholder}
                className={cn(errors[question.id] && 'border-red-500')}
                disabled={isSubmitting}
              />
            )}

            {question.type === 'textarea' && (
              <textarea
                value={answers[question.id] ?? ''}
                onChange={(e) => handleChange(question.id, e.target.value)}
                onFocus={() => {
                  if (highlightedQuestionId === question.id) setHighlightedQuestionId(null);
                }}
                placeholder={question.placeholder}
                rows={4}
                className={cn(
                  'w-full px-3 py-2 text-sm rounded-md border bg-background',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  errors[question.id] && 'border-red-500'
                )}
                disabled={isSubmitting}
              />
            )}

            {question.type === 'select' && question.options && (
              <select
                value={answers[question.id] ?? ''}
                onChange={(e) => handleChange(question.id, e.target.value)}
                onFocus={() => {
                  if (highlightedQuestionId === question.id) setHighlightedQuestionId(null);
                }}
                className={cn(
                  'w-full px-3 py-2 text-sm rounded-md border bg-background',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  errors[question.id] && 'border-red-500'
                )}
                disabled={isSubmitting}
              >
                <option value="">{t('workflow.interview.select-option')}</option>
                {question.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}

            {question.type === 'multiselect' && question.options && (
              <div
                className={cn(
                  'space-y-2',
                  errors[question.id] && 'rounded-md border border-red-500 p-2'
                )}
              >
                {question.options.map((option) => {
                  const selected = (answers[question.id] ?? '')
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const checked = selected.includes(option);
                  return (
                    <label
                      key={option}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isSubmitting}
                        onChange={() => {
                          const next = checked
                            ? selected.filter((s) => s !== option)
                            : [...selected, option];
                          handleChange(question.id, next.join(', '));
                        }}
                        className="h-4 w-4 rounded border-input"
                      />
                      <span>{option}</span>
                    </label>
                  );
                })}
              </div>
            )}

            {errors[question.id] && (
              <p className="text-xs text-red-500 mt-1">{errors[question.id]}</p>
            )}
          </div>
        </div>
      ))}

      <div className="flex gap-2 justify-end pt-4">
        {selectionError ? (
          <p role="alert" className="mr-auto text-sm text-red-600">
            {selectionError}
          </p>
        ) : null}
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {t('workflow.interview.cancel')}
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('workflow.interview.running') : t('workflow.interview.run')}
        </Button>
      </div>
    </form>
  );
}

function buildInitialAnswers(
  questions: InterviewQuestion[],
  activeMatter: Matter | null,
): Record<string, string> {
  const activeClientName = activeMatter ? activeMatter.client.trim() || matterLabel(activeMatter) : '';
  const activeClientFileName = activeMatter ? activeMatter.name.trim() || matterLabel(activeMatter) : '';
  const initial: Record<string, string> = {};
  for (const q of questions) {
    const defaultValue = q.defaultValue?.trim() ? q.defaultValue : undefined;
    initial[q.id] = defaultValue ?? getClientAutofillValue(q, activeClientName, activeClientFileName);
  }
  return initial;
}

function getClientAutofillValue(
  question: InterviewQuestion,
  activeClientName: string,
  activeClientFileName: string,
): string {
  const id = question.id.trim();
  if (id === 'matterName') {
    return activeClientFileName || activeClientName;
  }
  if (['clientName', 'clientOrganizationName', 'householdName'].includes(id)) {
    return activeClientName;
  }
  const label = question.question.trim().toLowerCase();
  if (label === 'client file name') {
    return activeClientFileName || activeClientName;
  }
  if ([
    'client name',
    'prospective client name',
    'client organization name',
    'client name and company',
    'household name',
  ].includes(label)) {
    return activeClientName;
  }
  return '';
}

export default InterviewForm;
