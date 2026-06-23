// src/features/matters/ClientQuestionsList.tsx
import { useState } from 'react';
import { Card, Eyebrow } from '@/ui/kp';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import type { ClientQuestion } from '@/platform/clientMap/types';

// A single stable empty-array reference so the selector never returns a fresh
// array (which would loop zustand's snapshot comparison) when a matter has no
// flagged questions yet.
const EMPTY_QUESTIONS: ClientQuestion[] = [];

const LABEL_HEADING = 'Questions for the client';
const LABEL_EMPTY = 'No questions flagged yet.';
const LABEL_COPY = 'Copy all';
const LABEL_COPIED = 'Copied';
const LABEL_REMOVE = 'Remove';

export interface ClientQuestionsListProps {
  matterId: string;
}

export function ClientQuestionsList({ matterId }: ClientQuestionsListProps) {
  // Select the raw stored array (stable reference) and default to a shared empty
  // array; do NOT call getClientQuestions in the selector (it returns a fresh
  // `?? []` each render, which loops the store subscription).
  const questions = useClientMapStore((s) => s.clientQuestions[matterId] ?? EMPTY_QUESTIONS);
  const removeClientQuestion = useClientMapStore((s) => s.removeClientQuestion);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const text = questions.map((q) => `- ${q.text}`).join('\n');
    const done = () => {
      setCopied(true);
      window.setTimeout(() => { setCopied(false); }, 1500);
    };
    // navigator.clipboard is unavailable in some webviews / insecure contexts;
    // fall back to a hidden textarea so copy still works.
    const clip = navigator.clipboard as { writeText?: (t: string) => Promise<void> } | undefined;
    if (clip?.writeText) {
      clip.writeText(text).then(done).catch(() => { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  return (
    <Card variant="raised" data-testid="clientmap-client-questions">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Eyebrow>{LABEL_HEADING}</Eyebrow>
        {questions.length > 0 && (
          <button
            type="button"
            data-testid="clientmap-questions-copy"
            onClick={handleCopy}
            style={{ fontSize: 12, color: '#2563eb', background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
          >
            {copied ? LABEL_COPIED : LABEL_COPY}
          </button>
        )}
      </div>
      {questions.length === 0 ? (
        <p>{LABEL_EMPTY}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {questions.map((q) => (
            <li
              key={q.id}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0' }}
            >
              <span style={{ flex: 1, fontSize: 13, color: '#374151' }}>{q.text}</span>
              <button
                type="button"
                data-testid="clientmap-question-remove"
                aria-label={`${LABEL_REMOVE}: ${q.text}`}
                onClick={() => { removeClientQuestion(matterId, q.id); }}
                style={{ fontSize: 12, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
              >
                {LABEL_REMOVE}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Last-resort clipboard copy for environments without navigator.clipboard. */
function fallbackCopy(text: string): void {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    // execCommand is deprecated but is the only synchronous copy available in
    // webviews/insecure contexts where navigator.clipboard is absent. Justified
    // legacy fallback; the clipboard API path above is preferred.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch {
    // Best-effort: if even the fallback fails, the user can still read the list.
  }
}
