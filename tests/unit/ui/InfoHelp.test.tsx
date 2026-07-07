/**
 * InfoHelp — the "i" hover-tooltip primitive from the UI Simplification Pass.
 * Content must stay hidden until the trigger is hovered/focused, and clicking
 * or activating it must not leak through to a parent interactive element
 * (InfoHelp is often nested inside a selectable card).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { InfoHelp } from '@/ui/InfoHelp';

afterEach(cleanup);

describe('InfoHelp', () => {
  it('does not show its content until the trigger is hovered or focused', () => {
    render(<InfoHelp content="Explains the thing." label="About the thing" />);
    expect(screen.queryByText('Explains the thing.')).not.toBeInTheDocument();
  });

  it('reveals its content immediately on hover', () => {
    render(<InfoHelp content="Explains the thing." label="About the thing" />);
    const trigger = screen.getByRole('button', { name: 'About the thing' });

    fireEvent.mouseEnter(trigger);

    expect(screen.getByRole('tooltip')).toHaveTextContent('Explains the thing.');
  });

  it('toggles its content on click', () => {
    render(<InfoHelp content="Explains the thing." label="About the thing" />);
    const trigger = screen.getByRole('button', { name: 'About the thing' });

    fireEvent.click(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Explains the thing.');

    fireEvent.click(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('supports keyboard toggle and Escape close', () => {
    render(<InfoHelp content="Explains the thing." label="About the thing" />);
    const trigger = screen.getByRole('button', { name: 'About the thing' });

    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Explains the thing.');
    expect(trigger).toHaveAttribute('aria-describedby');

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('reveals its content on focus and hides it again on blur', async () => {
    render(<InfoHelp content="Explains the thing." label="About the thing" />);
    const trigger = screen.getByRole('button', { name: 'About the thing' });

    fireEvent.focus(trigger);
    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveTextContent('Explains the thing.');
    });

    fireEvent.blur(trigger);
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  it('renders as a span when as="span", for nesting inside another interactive element', () => {
    render(<InfoHelp content="Nested help." label="Nested info" as="span" />);
    const trigger = screen.getByRole('button', { name: 'Nested info' });
    expect(trigger.tagName).toBe('SPAN');
  });

  it('stops a click on the trigger from reaching a parent onClick handler', () => {
    const onParentClick = vi.fn();
    render(
      <button type="button" onClick={onParentClick}>
        <InfoHelp content="Nested help." label="Nested info" as="span" />
      </button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Nested info' }));
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
