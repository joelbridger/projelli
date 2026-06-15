import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Plus, Search } from 'lucide-react';
import {
  Badge,
  Button,
  CountBadge,
  IconButton,
  SearchField,
  SegmentedToggle,
} from '@/components/ui/kp';

describe('kp Button', () => {
  it('renders children and applies the variant + size classes', () => {
    render(
      <Button variant="primary" size="md">
        New matter
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'New matter' });
    expect(btn.className).toContain('kp-btn--primary');
    expect(btn.className).toContain('kp-btn--md');
  });

  it('is disabled while loading', () => {
    render(<Button loading>Save</Button>);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  // The exact bug Jameson flagged: same-role buttons must be identical regardless of label.
  it('produces identical classes for New matter vs New email at the same variant+size', () => {
    const { rerender } = render(
      <Button variant="primary" size="md" iconLeft={Plus}>
        New matter
      </Button>,
    );
    const a = screen.getByRole('button').className;
    rerender(
      <Button variant="primary" size="md" iconLeft={Plus}>
        New email
      </Button>,
    );
    const b = screen.getByRole('button').className;
    expect(a).toBe(b);
  });
});

describe('kp IconButton', () => {
  it('exposes the required accessible label', () => {
    render(<IconButton icon={Plus} label="Add item" />);
    expect(screen.getByRole('button', { name: 'Add item' }).getAttribute('aria-label')).toBe('Add item');
  });
});

describe('kp Badge', () => {
  it('applies the variant class', () => {
    render(<Badge variant="privilege">Privileged</Badge>);
    expect(screen.getByText('Privileged').className).toContain('kp-badge--privilege');
  });
});

describe('kp SegmentedToggle', () => {
  it('marks the active option and fires onChange', () => {
    const onChange = vi.fn();
    render(
      <SegmentedToggle
        ariaLabel="Scope"
        value="matter"
        onChange={onChange}
        options={[
          { value: 'matter', label: 'This matter' },
          { value: 'all', label: 'All' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith('all');
    expect(screen.getByRole('button', { name: 'This matter' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('kp CountBadge', () => {
  it('renders the count', () => {
    render(<CountBadge count={3} />);
    expect(screen.getByText('3').className).toContain('kp-count-badge');
  });
});

describe('kp SearchField', () => {
  it('reports new values and clears', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<SearchField value="abc" onChange={onChange} onClear={onClear} placeholder="Search" icon={Search} />);
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'abcd' } });
    expect(onChange).toHaveBeenCalledWith('abcd');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onClear).toHaveBeenCalled();
  });
});
