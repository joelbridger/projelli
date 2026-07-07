// Tests for ConversationsRail — the persistent left rail of saved Ask threads.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConversationsRail, type RailGroup } from '@/features/ask/ConversationsRail';

const GROUPS: RailGroup[] = [
  {
    key: 'this-client',
    title: 'This client',
    items: [
      { chatId: 'ask-m1-2000', label: 'What is the discovery deadline?', dateLabel: 'Jan 2 9:30 AM' },
      { chatId: 'ask-m1-1000', label: 'What are the deposition highlights?', dateLabel: 'Jan 1 8:00 AM' },
    ],
  },
  {
    key: 'other',
    title: 'Other conversations',
    items: [{ chatId: 'ask-global-500', label: 'Cross-matter question', dateLabel: 'Dec 31 5:00 PM' }],
  },
];

function renderRail(overrides: Partial<React.ComponentProps<typeof ConversationsRail>> = {}) {
  const props = {
    groups: GROUPS,
    activeChatId: 'ask-m1-2000',
    onSelect: vi.fn(),
    onNewQuestion: vi.fn(),
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    ...overrides,
  };
  render(<ConversationsRail {...props} />);
  return props;
}

describe('ConversationsRail', () => {
  it('renders group headings and one item per session', () => {
    renderRail();
    expect(screen.getByTestId('conversations-rail')).toBeInTheDocument();
    expect(screen.getByText('This client')).toBeInTheDocument();
    expect(screen.getByText('Other conversations')).toBeInTheDocument();
    expect(screen.getAllByTestId('rail-conversation-item').length).toBe(3);
    expect(screen.getByText(/discovery deadline/i)).toBeInTheDocument();
    expect(screen.getByText(/cross-matter question/i)).toBeInTheDocument();
  });

  it('marks the active thread (data-active + aria-current)', () => {
    renderRail({ activeChatId: 'ask-m1-2000' });
    const items = screen.getAllByTestId('rail-conversation-item');
    const active = items.filter((el) => el.getAttribute('data-active') === 'true');
    expect(active.length).toBe(1);
    expect(active[0]!.getAttribute('aria-current')).toBe('true');
    expect(active[0]!.textContent).toMatch(/discovery deadline/i);
  });

  it('clicking a conversation calls onSelect with its chatId', () => {
    const props = renderRail();
    fireEvent.click(screen.getByText(/deposition highlights/i));
    expect(props.onSelect).toHaveBeenCalledWith('ask-m1-1000');
  });

  it('"New question" calls onNewQuestion', () => {
    const props = renderRail();
    fireEvent.click(screen.getByTestId('rail-new-question'));
    expect(props.onNewQuestion).toHaveBeenCalledTimes(1);
  });

  it('searches conversation titles from the field under New question', () => {
    renderRail();
    fireEvent.change(screen.getByTestId('rail-conversation-search'), {
      target: { value: 'deposition' },
    });

    expect(screen.getByText(/deposition highlights/i)).toBeInTheDocument();
    expect(screen.queryByText(/discovery deadline/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cross-matter question/i)).not.toBeInTheDocument();
  });

  it('shows an empty search state when no conversation title matches', () => {
    renderRail();
    fireEvent.change(screen.getByTestId('rail-conversation-search'), {
      target: { value: 'nothing here' },
    });

    expect(screen.queryAllByTestId('rail-conversation-item').length).toBe(0);
    expect(screen.getByTestId('rail-conversation-search-empty')).toBeInTheDocument();
  });

  it('the toggle calls onToggleCollapsed', () => {
    const props = renderRail();
    fireEvent.click(screen.getByTestId('rail-toggle'));
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('collapsed: thin strip with new-question + toggle, no conversation items', () => {
    renderRail({ collapsed: true });
    const rail = screen.getByTestId('conversations-rail');
    expect(rail.getAttribute('data-collapsed')).toBe('true');
    expect(screen.getByTestId('rail-new-question')).toBeInTheDocument();
    expect(screen.getByTestId('rail-toggle')).toBeInTheDocument();
    expect(screen.queryAllByTestId('rail-conversation-item').length).toBe(0);
  });

  it('shows the empty hint when there are no conversations', () => {
    renderRail({ groups: [{ key: 'all', title: null, items: [] }] });
    expect(screen.queryAllByTestId('rail-conversation-item').length).toBe(0);
    expect(screen.getByText(/your conversations will appear here/i)).toBeInTheDocument();
  });

  it('a null group title renders an ungrouped flat list', () => {
    renderRail({
      groups: [
        {
          key: 'all',
          title: null,
          items: [{ chatId: 'ask-global-1', label: 'Flat one', dateLabel: 'Jan 1' }],
        },
      ],
    });
    expect(screen.getByText('Flat one')).toBeInTheDocument();
    expect(screen.getAllByTestId('rail-conversation-item').length).toBe(1);
  });
});
