import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMeterBar } from '@/components/chat/ContextMeterBar';

describe('ContextMeterBar', () => {
  const base = {
    usedTokens: 100_000,
    limitTokens: 200_000,
    projectedCost: 0.38,
    modelLabel: 'Sonnet',
    onCompressClick: vi.fn(),
  };

  it('renders usage and cost', () => {
    render(<ContextMeterBar {...base} />);
    expect(screen.getByTestId('context-meter-usage').textContent).toContain('100K of 200K');
    expect(screen.getByTestId('context-meter-cost').textContent).toContain('$0.38');
  });

  it('does NOT show warning below 80%', () => {
    render(<ContextMeterBar {...base} usedTokens={150_000} />);
    expect(screen.queryByTestId('context-meter-warning')).toBeNull();
  });

  it('shows warning at 80%', () => {
    render(<ContextMeterBar {...base} usedTokens={160_000} />);
    expect(screen.getByTestId('context-meter-warning')).toBeTruthy();
  });

  it('shows warning text with percentage', () => {
    render(<ContextMeterBar {...base} usedTokens={160_000} />);
    expect(screen.getByTestId('context-meter-warning').textContent).toContain('80%');
  });

  it('shows compress button at 50%+', () => {
    render(<ContextMeterBar {...base} usedTokens={100_001} />);
    expect(screen.getByTestId('context-meter-compress-btn')).toBeTruthy();
  });

  it('hides compress button below 50%', () => {
    render(<ContextMeterBar {...base} usedTokens={50_000} />);
    expect(screen.queryByTestId('context-meter-compress-btn')).toBeNull();
  });

  it('calls onCompressClick when button clicked', () => {
    const onClick = vi.fn();
    render(<ContextMeterBar {...base} usedTokens={120_000} onCompressClick={onClick} />);
    fireEvent.click(screen.getByTestId('context-meter-compress-btn'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders null cost gracefully', () => {
    render(<ContextMeterBar {...base} projectedCost={null} />);
    expect(screen.queryByTestId('context-meter-cost')).toBeNull();
  });

  it('shows the model label in cost text', () => {
    render(<ContextMeterBar {...base} modelLabel="gpt-4o" />);
    expect(screen.getByTestId('context-meter-cost').textContent).toContain('gpt-4o');
  });
});
