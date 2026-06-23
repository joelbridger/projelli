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
  const question = questions[index];

  if (questions.length === 0 || !question) {
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

  // Answering or flagging marks the current gap resolved (BUG-106), so it is
  // pruned from interviewQuestions and the next gap slides into the same index.
  // We therefore clamp rather than increment: incrementing would skip the gap
  // that just took this slot.
  function advance() {
    setAnswer('');
    setIndex((i) => Math.max(0, Math.min(i, questions.length - 2)));
  }

  function handleSubmit() {
    if (!question || !answer.trim()) return;
    // Route the answer to the section this gap question came from, and mark the
    // gap resolved so the interview does not replay it (BUG-106).
    answerQuestion(matterId, question.sectionKey, answer.trim(), question.text);
    advance();
  }

  function handleFlag() {
    if (!question) return;
    flagForClient(matterId, question.text);
    advance();
  }

  return (
    <Card variant="raised">
      <Eyebrow>{questionOfLabel(index + 1, questions.length)}</Eyebrow>
      <p style={{ marginBottom: '0.75rem' }}>{question.text}</p>
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
