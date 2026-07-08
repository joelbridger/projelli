// Whole-practice Ask answer surface: the model's short answer plus one chip
// per matching client. Each chip opens that client's Client Map; each cited
// fact underneath opens the source passage. Facts always show (no expand
// toggle) — one client rarely has more than a couple of matching facts.
import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';
import { Chip, Callout } from '@/ui/kp';
import type { SourceRef } from '@/platform/clientMap/types';
import type { BookAskResult } from './bookFacts';

export function BookAnswerPanel({ result, loading, error, onOpenClient, onOpenSource }: {
  result: (BookAskResult & { model: string }) | null;
  loading: boolean;
  error: string | null;
  onOpenClient: (matterId: string) => void;
  /** The full SourceRef (not just ref+snippet) so the caller can dispatch by
   *  its real `kind` — email/CRM/etc. sources open differently than documents. */
  onOpenSource: (matterId: string, source: SourceRef) => void;
}) {
  const { t } = useTranslation();
  if (loading) return <p data-testid="book-loading" style={{ fontSize: 13 }}>{t('ask.book.loading')}</p>;
  if (error) return <Callout variant="warning">{error}</Callout>;
  if (!result) return null;
  if (result.model === '') return <Callout>{t('ask.book.no-facts')}</Callout>;
  return (
    <div data-testid="book-answer-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p data-testid="book-answer" style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>{result.answer}</p>
      {result.matches.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--kp-text-muted, #6b7280)' }}>{t('ask.book.no-matches')}</p>
      ) : (
        <div>
          <span className="kp-eyebrow">{t('ask.book.matches-heading')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
            {result.matches.map((m) => (
              <div key={m.matterId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Chip size="md" icon={FolderOpen} data-testid={`book-client-chip-${m.matterId}`}
                  onClick={() => { onOpenClient(m.matterId); }}>
                  {m.label}
                </Chip>
                {m.facts.map((f) => (
                  <button key={f.itemId} type="button" data-testid={`book-fact-${f.itemId}`}
                    onClick={() => { if (f.source) onOpenSource(m.matterId, f.source); else onOpenClient(m.matterId); }}
                    style={{ textAlign: 'left', fontSize: 12.5, background: 'var(--kp-surface-2, #f8fafc)', border: '1px solid var(--kp-divider, #e5e7eb)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', maxWidth: 420 }}>
                    {f.text}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <span
        title={t('ask.book.summaries-note-title')}
        style={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          borderRadius: 999,
          border: '1px solid var(--kp-divider)',
          background: 'var(--kp-bg-soft)',
          padding: '3px 8px',
          fontSize: 11.5,
          fontWeight: 600,
          color: 'var(--kp-text-muted, #6b7280)',
        }}
      >
        {t('ask.book.summaries-note')}
      </span>
    </div>
  );
}
