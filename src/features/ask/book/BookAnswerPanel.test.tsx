import '@/i18n';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BookAnswerPanel } from './BookAnswerPanel';

const result = {
  answer: 'Alvarez and Bishop both mention 529 plans.',
  model: 'test-model',
  matches: [
    { matterId: 'm1', label: 'Alvarez', facts: [{ itemId: 'i1', sectionKey: 'goals', text: '529 for grandkids', source: { kind: 'document' as const, ref: '/w/Alvarez/plan.pdf', snippet: '529 for grandkids' } }] },
    { matterId: 'm2', label: 'Bishop', facts: [{ itemId: 'i2', sectionKey: 'goals', text: '529 for niece' }] },
  ],
};

describe('BookAnswerPanel', () => {
  it('renders the answer and one chip per matching client', () => {
    render(<BookAnswerPanel result={result} loading={false} error={null} onOpenClient={() => {}} onOpenSource={() => {}} />);
    expect(screen.getByTestId('book-answer').textContent).toContain('Alvarez and Bishop');
    expect(screen.getByTestId('book-client-chip-m1')).toBeTruthy();
    expect(screen.getByTestId('book-client-chip-m2')).toBeTruthy();
  });
  it('chip click opens that client; cited fact click opens the source passage', () => {
    const openClient = vi.fn();
    const openSource = vi.fn();
    render(<BookAnswerPanel result={result} loading={false} error={null} onOpenClient={openClient} onOpenSource={openSource} />);
    fireEvent.click(screen.getByTestId('book-client-chip-m1'));
    expect(openClient).toHaveBeenCalledWith('m1');
    fireEvent.click(screen.getByTestId('book-fact-i1'));
    expect(openSource).toHaveBeenCalledWith('m1', '/w/Alvarez/plan.pdf', '529 for grandkids');
  });
});
