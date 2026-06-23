// src/features/matters/ClientQuestionsList.tsx
import { Card, Eyebrow } from '@/ui/kp';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';

const LABEL_HEADING = 'Questions for the client';
const LABEL_EMPTY = 'No questions flagged yet.';

export interface ClientQuestionsListProps {
  matterId: string;
}

export function ClientQuestionsList({ matterId }: ClientQuestionsListProps) {
  const questions = useClientMapStore((s) => s.getClientQuestions(matterId));

  return (
    <Card variant="raised" data-testid="clientmap-client-questions">
      <Eyebrow>{LABEL_HEADING}</Eyebrow>
      {questions.length === 0 ? (
        <p>{LABEL_EMPTY}</p>
      ) : (
        <ul>
          {questions.map((q) => (
            <li key={q.id}>{q.text}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
