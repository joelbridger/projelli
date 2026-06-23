// src/features/matters/GuidedInterview.tsx
import { useState } from 'react';
import { Card, Eyebrow, Button } from '@/ui/kp';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { interviewQuestions, answerQuestion, flagForClient } from '@/platform/clientMap/guidedInterview';

const LABEL_ANSWER_PLACEHOLDER = 'Type your answer here...';
const LABEL_SUBMIT = 'I know this';
const LABEL_FLAG = 'Ask the client';
const LABEL_ALL_CAUGHT_UP = 'All caught up';
const LABEL_NO_QUESTIONS = 'No open questions right now.';
const LABEL_CLOSE = 'Close';

function questionOfLabel(current: number, total: number): string {
  return `Question ${String(current)} of ${String(total)}`;
}

export interface GuidedInterviewProps {
  matterId: string;
  onClose: () => void;
}

export function GuidedInterview({ matterId, onClose }: GuidedInterviewProps) {
  const map = useClientMapStore((s) => s.getMap(matterId));
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');

  if (!map) return null;

  const questions = interviewQuestions(map);

  if (questions.length === 0 || index >= questions.length) {
    return (
      <Card variant="raised">
        <Eyebrow>{LABEL_ALL_CAUGHT_UP}</Eyebrow>
        <p>{LABEL_NO_QUESTIONS}</p>
        <Button variant="secondary" size="sm" onClick={onClose}>
          {LABEL_CLOSE}
        </Button>
      </Card>
    );
  }

  const question = questions[index] ?? '';

  function advance() {
    setAnswer('');
    setIndex((i) => i + 1);
  }

  function handleSubmit() {
    if (!answer.trim()) return;
    answerQuestion(matterId, 'standing', answer.trim());
    advance();
  }

  function handleFlag() {
    flagForClient(matterId, question);
    advance();
  }

  return (
    <Card variant="raised">
      <Eyebrow>{questionOfLabel(index + 1, questions.length)}</Eyebrow>
      <p style={{ marginBottom: '0.75rem' }}>{question}</p>
      <input
        data-testid="clientmap-interview-answer"
        type="text"
        placeholder={LABEL_ANSWER_PLACEHOLDER}
        value={answer}
        onChange={(e) => { setAnswer(e.target.value); }}
        style={{ display: 'block', width: '100%', marginBottom: '0.5rem', padding: '0.375rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.25rem' }}
      />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <Button
          data-testid="clientmap-interview-submit"
          size="sm"
          onClick={handleSubmit}
        >
          {LABEL_SUBMIT}
        </Button>
        <Button
          data-testid="clientmap-interview-flag"
          variant="secondary"
          size="sm"
          onClick={handleFlag}
        >
          {LABEL_FLAG}
        </Button>
      </div>
    </Card>
  );
}
