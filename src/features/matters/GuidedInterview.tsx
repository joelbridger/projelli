// src/features/matters/GuidedInterview.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eyebrow, Button } from '@/ui/kp';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { interviewQuestions, answerQuestion, flagForClient } from '@/features/matters/clientMap/guidedInterview';

function questionOfLabel(current: number, total: number): string {
  return `${String(current)} / ${String(total)}`;
}

export interface GuidedInterviewProps {
  matterId: string;
  onClose: () => void;
}

export function GuidedInterview({ matterId, onClose }: GuidedInterviewProps) {
  const { t } = useTranslation();
  const map = useClientMapStore((s) => s.getMap(matterId));
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');

  if (!map) return null;

  const questions = interviewQuestions(map);
  const question = questions[index];

  if (questions.length === 0 || !question) return null;

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
    <div
      data-testid="clientmap-guided-interview"
      style={{
        borderTop: '1px solid var(--kp-divider)',
        borderBottom: '1px solid var(--kp-divider)',
        padding: 'var(--kp-space-md) 0',
      }}
    >
      <Eyebrow>{questionOfLabel(index + 1, questions.length)}</Eyebrow>
      <p style={{ marginBottom: '0.75rem' }}>{question.text}</p>
      <input
        data-testid="clientmap-interview-answer"
        type="text"
        placeholder={t('matter.client-map.interview-answer-placeholder')}
        value={answer}
        onChange={(e) => { setAnswer(e.target.value); }}
        style={{
          display: 'block',
          width: '100%',
          marginBottom: '0.5rem',
          padding: '0.375rem 0.5rem',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
        }}
      />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <Button
          data-testid="clientmap-interview-submit"
          size="sm"
          onClick={handleSubmit}
        >
          {t('matter.client-map.interview-save')}
        </Button>
        <Button
          data-testid="clientmap-interview-flag"
          variant="secondary"
          size="sm"
          onClick={handleFlag}
        >
          {t('matter.client-map.interview-flag')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
        >
          {t('matter.client-map.close')}
        </Button>
      </div>
    </div>
  );
}
