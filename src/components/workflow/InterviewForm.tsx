// Interview Form Component
// Collects answers to workflow interview questions

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { InterviewQuestion } from '@/types/workflow';
import { cn } from '@/lib/utils';

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
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const q of questions) {
      initial[q.id] = q.defaultValue ?? '';
    }
    return initial;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

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

    // Validate required fields
    const newErrors: Record<string, string> = {};
    for (const q of questions) {
      if (q.required && !answers[q.id]?.trim()) {
        newErrors[q.id] = 'This field is required';
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSubmit(answers);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {questions.map((question) => (
        <Card key={question.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {question.question}
              {question.required && <span className="text-red-500 ml-1">*</span>}
            </CardTitle>
            {question.description && (
              <CardDescription className="text-xs">
                {question.description}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {question.type === 'text' && (
              <Input
                type="text"
                value={answers[question.id] ?? ''}
                onChange={(e) => handleChange(question.id, e.target.value)}
                placeholder={question.placeholder}
                className={cn(errors[question.id] && 'border-red-500')}
                disabled={isSubmitting}
              />
            )}

            {question.type === 'textarea' && (
              <textarea
                value={answers[question.id] ?? ''}
                onChange={(e) => handleChange(question.id, e.target.value)}
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
                className={cn(
                  'w-full px-3 py-2 text-sm rounded-md border bg-background',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  errors[question.id] && 'border-red-500'
                )}
                disabled={isSubmitting}
              >
                <option value="">Select an option</option>
                {question.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}

            {errors[question.id] && (
              <p className="text-xs text-red-500 mt-1">{errors[question.id]}</p>
            )}
          </CardContent>
        </Card>
      ))}

      <div className="flex gap-2 justify-end pt-4">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Processing...' : 'Continue'}
        </Button>
      </div>
    </form>
  );
}

export default InterviewForm;
