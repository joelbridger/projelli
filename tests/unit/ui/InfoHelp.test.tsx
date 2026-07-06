/**
 * InfoHelp — the "i" hover-tooltip primitive from the UI Simplification Pass.
 * Content must stay hidden until the trigger is hovered/focused, and clicking
 * or activating it must not leak through to a parent interactive element
 * (InfoHelp is often nested inside a selectable card).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { InfoHelp } from '@/ui/InfoHelp';
import { TooltipProvider } from '@/ui/tooltip';

afterEach(cleanup);

/** InfoHelp relies on Radix's Tooltip.Root, which requires a TooltipProvider ancestor
 * (mounted for real once, at the app root in main.tsx). */
function renderWithProvider(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe('InfoHelp', () => {
  it('does not show its content until the trigger is hovered or focused', () => {
    renderWithProvider(<InfoHelp content="Explains the thing." label="About the thing" />);
    expect(screen.queryByText('Explains the thing.')).not.toBeInTheDocument();
  });

  it('reveals its content on focus and hides it again on blur', async () => {
    renderWithProvider(<InfoHelp content="Explains the thing." label="About the thing" />);
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
    renderWithProvider(<InfoHelp content="Nested help." label="Nested info" as="span" />);
    const trigger = screen.getByRole('button', { name: 'Nested info' });
    expect(trigger.tagName).toBe('SPAN');
  });

  it('stops a click on the trigger from reaching a parent onClick handler', () => {
    const onParentClick = vi.fn();
    renderWithProvider(
      <button type="button" onClick={onParentClick}>
        <InfoHelp content="Nested help." label="Nested info" as="span" />
      </button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Nested info' }));
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
