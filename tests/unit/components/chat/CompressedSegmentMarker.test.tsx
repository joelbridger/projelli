import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompressedSegmentMarker } from '@/components/chat/CompressedSegmentMarker';
import type { ChatMessage } from '@/types/ai';

function summaryMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    role: 'assistant',
    content: 'This segment summarized topic A and decided to proceed with plan B.',
    timestamp: '2024-01-01T00:00:00Z',
    isCompressedSummary: true,
    originalMessageCount: 8,
    ...overrides,
  };
}

describe('CompressedSegmentMarker', () => {
  it('shows original message count', () => {
    render(<CompressedSegmentMarker message={summaryMsg()} onExpand={vi.fn()} />);
    expect(screen.getByTestId('compressed-segment-label').textContent).toContain('8 messages');
  });

  it('shows singular "message" for count of 1', () => {
    render(<CompressedSegmentMarker message={summaryMsg({ originalMessageCount: 1 })} onExpand={vi.fn()} />);
    expect(screen.getByTestId('compressed-segment-label').textContent).toContain('1 message');
  });

  it('shows Expand button when not expanded', () => {
    render(<CompressedSegmentMarker message={summaryMsg()} onExpand={vi.fn()} />);
    expect(screen.getByTestId('compressed-segment-expand-btn').textContent).toBe('Expand');
  });

  it('shows Collapse and badge when expanded', () => {
    render(
      <CompressedSegmentMarker
        message={summaryMsg({ expandedForNextSend: true })}
        onExpand={vi.fn()}
      />
    );
    expect(screen.getByTestId('compressed-segment-expand-btn').textContent).toBe('Collapse');
    expect(screen.getByTestId('compressed-segment-expanded-badge')).toBeTruthy();
  });

  it('does NOT show expanded badge when not expanded', () => {
    render(<CompressedSegmentMarker message={summaryMsg()} onExpand={vi.fn()} />);
    expect(screen.queryByTestId('compressed-segment-expanded-badge')).toBeNull();
  });

  it('calls onExpand with message timestamp when clicked', () => {
    const onExpand = vi.fn();
    render(<CompressedSegmentMarker message={summaryMsg()} onExpand={onExpand} />);
    fireEvent.click(screen.getByTestId('compressed-segment-expand-btn'));
    expect(onExpand).toHaveBeenCalledWith('2024-01-01T00:00:00Z');
  });

  it('renders the compressed-segment-marker container', () => {
    render(<CompressedSegmentMarker message={summaryMsg()} onExpand={vi.fn()} />);
    expect(screen.getByTestId('compressed-segment-marker')).toBeTruthy();
  });
});
