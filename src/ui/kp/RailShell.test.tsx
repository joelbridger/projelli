import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RailShell, RailShellActionMenu, RailShellHeader } from '@/ui/kp';

const ITEMS = [
  { id: 'brief', label: 'Prep brief', supportingText: 'Ready' },
  { id: 'notes', label: 'Meeting notes', supportingText: 'Draft' },
  { id: 'email', label: 'Client email', supportingText: 'Unread' },
];

function getRailRow(label: string): HTMLElement {
  const row = screen.getByText(label).closest('[role="listitem"]');
  if (!(row instanceof HTMLElement)) throw new Error(`Missing rail row for ${label}`);
  return row;
}

describe('RailShell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a fixed left rail with active selection and filled right pane', () => {
    const onSelect = vi.fn();

    render(
      <RailShell
        header={<RailShellHeader title="Client work" />}
        listAriaLabel="Client work"
        items={ITEMS}
        activeId="notes"
        onSelect={onSelect}
      >
        <section>Selected detail</section>
      </RailShell>,
    );

    expect(screen.getByRole('list', { name: 'Client work' })).toBeTruthy();
    const activeRow = getRailRow('Meeting notes');
    expect(activeRow.getAttribute('aria-current')).toBe('page');
    expect(activeRow.className).toContain('bg-[var(--kp-side-active-bg)]');
    expect(document.body.contains(screen.getByText('Selected detail'))).toBe(true);

    fireEvent.click(getRailRow('Client email'));
    expect(onSelect).toHaveBeenCalledWith('email');
  });

  it('can opt into rendering only the visible row window for large lists', async () => {
    const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return 520; } });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 280; } });

    try {
      const items = Array.from({ length: 200 }, (_, index) => ({
        id: `item-${String(index)}`,
        label: `Client item ${String(index)}`,
        testId: `virtual-rail-row-${String(index)}`,
      }));

      render(
        <RailShell
          header={<RailShellHeader title="Client work" />}
          listAriaLabel="Client work"
          items={items}
          activeId="item-0"
          onSelect={() => {}}
          virtualization={{ enabled: true, estimateSize: 44, overscan: 2 }}
        >
          <section>Selected detail</section>
        </RailShell>,
      );

      await waitFor(() => {
        const rows = screen.getAllByTestId(/^virtual-rail-row-/);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThan(200);
      });
      expect(screen.queryByText('Client item 199')).toBeNull();
    } finally {
      if (heightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightDescriptor);
      }
      if (widthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthDescriptor);
      }
    }
  });

  it('scrolls the active row into view when selection changes', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { rerender } = render(
      <RailShell
        header={<RailShellHeader title="Client work" />}
        listAriaLabel="Client work"
        items={ITEMS}
        activeId="brief"
        onSelect={() => {}}
      >
        <section>Brief detail</section>
      </RailShell>,
    );

    scrollIntoView.mockClear();
    rerender(
      <RailShell
        header={<RailShellHeader title="Client work" />}
        listAriaLabel="Client work"
        items={ITEMS}
        activeId="email"
        onSelect={() => {}}
      >
        <section>Email detail</section>
      </RailShell>,
    );

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });

  it('moves keyboard focus with arrow-key selection', () => {
    function KeyboardHarness() {
      const [activeId, setActiveId] = useState('notes');
      return (
        <RailShell
          header={<RailShellHeader title="Client work" />}
          listAriaLabel="Client work"
          items={ITEMS}
          activeId={activeId}
          onSelect={setActiveId}
        >
          <section>{activeId}</section>
        </RailShell>
      );
    }

    render(<KeyboardHarness />);

    const notesRow = getRailRow('Meeting notes');
    notesRow.focus();

    fireEvent.keyDown(notesRow, { key: 'ArrowDown' });

    const emailRow = getRailRow('Client email');
    expect(emailRow.getAttribute('aria-current')).toBe('page');
    expect(document.activeElement).toBe(emailRow);

    fireEvent.keyDown(emailRow, { key: 'ArrowUp' });

    expect(notesRow.getAttribute('aria-current')).toBe('page');
    expect(document.activeElement).toBe(notesRow);
  });

  it('does not steal clicks from controls inside custom row content', () => {
    const onSelect = vi.fn();
    const onNestedAction = vi.fn();

    render(
      <RailShell
        header={<RailShellHeader title="Client work" />}
        listAriaLabel="Client work"
        items={[
          {
            id: 'interactive',
            label: 'Interactive row',
            content: (
              <span>
                Interactive row
                <button type="button" onClick={onNestedAction}>Nested action</button>
              </span>
            ),
          },
        ]}
        activeId="interactive"
        onSelect={onSelect}
      >
        <section>Detail</section>
      </RailShell>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Nested action' }));

    expect(onNestedAction).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('provides small plus and overflow menu triggers for rail headers', () => {
    render(
      <RailShellHeader
        title="Emails"
        actions={
          <>
            <RailShellActionMenu icon={Plus} label="Add email">
              <button type="button">New email</button>
            </RailShellActionMenu>
            <RailShellActionMenu icon={MoreHorizontal} label="More email actions">
              <button type="button">Filters</button>
            </RailShellActionMenu>
          </>
        }
      />,
    );

    expect(screen.getByRole('button', { name: 'Add email' }).className).toContain('kp-icon-btn');
    expect(screen.getByRole('button', { name: 'More email actions' }).className).toContain('kp-icon-btn');
  });
});
