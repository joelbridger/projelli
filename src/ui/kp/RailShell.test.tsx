import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MoreVertical, Plus } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RailShell, RailShellActionMenu, RailShellHeader } from '@/ui/kp';

const ITEMS = [
  { id: 'brief', label: 'Prep brief', supportingText: 'Ready' },
  { id: 'notes', label: 'Meeting notes', supportingText: 'Draft' },
  { id: 'email', label: 'Client email', supportingText: 'Unread' },
];

function getRailRow(label: string): HTMLElement {
  return screen.getByRole('option', { name: new RegExp(label, 'i') });
}

function installVirtualRailLayout() {
  const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return 520; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 280; } });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options?: ScrollToOptions | number, y?: number) {
      this.scrollTop = typeof options === 'number' ? y ?? 0 : options?.top ?? this.scrollTop;
      queueMicrotask(() => {
        this.dispatchEvent(new Event('scroll'));
      });
    },
  });

  return () => {
    if (heightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightDescriptor);
    }
    if (widthDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthDescriptor);
    }
    if (scrollToDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor);
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
    }
  };
}

async function flushVirtualRailTimers() {
  await act(async () => {
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();
  });
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

    expect(screen.getByRole('listbox', { name: 'Client work' })).toBeTruthy();
    const list = screen.getByRole('listbox', { name: 'Client work' });
    const rail = list.parentElement;
    expect(rail?.className).toContain('bg-[var(--color-background)]');
    expect(rail?.className).not.toContain('bg-[var(--kp-side-bg)]');
    expect(rail?.className).toContain('border-[var(--kp-divider)]');
    expect(rail?.style.width).toBe('var(--kp-rail-width)');
    expect(rail?.style.minWidth).toBe('var(--kp-rail-width)');
    expect(rail?.style.maxWidth).toBe('var(--kp-rail-width)');
    expect(list.className).toContain('gap-1.5');
    expect(list.className).toContain('p-3');
    const activeRow = getRailRow('Meeting notes');
    expect(activeRow.getAttribute('aria-selected')).toBe('true');
    expect(activeRow.getAttribute('tabindex')).toBe('0');
    expect(getRailRow('Prep brief').getAttribute('tabindex')).toBe('-1');
    expect(activeRow.className).toContain('px-3');
    expect(activeRow.className).toContain('py-2.5');
    expect(activeRow.className).toContain('bg-[var(--kp-accent-soft)]');
    expect(activeRow.className).toContain('border-[rgba(var(--kp-navy-rgb),0.10)]');
    expect(activeRow.className).not.toContain('bg-[var(--kp-side-active-bg)]');
    expect(document.body.contains(screen.getByText('Selected detail'))).toBe(true);

    fireEvent.click(getRailRow('Client email'));
    expect(onSelect).toHaveBeenCalledWith('email');
  });

  it('can opt into rendering only the visible row window for large lists', async () => {
    const restoreVirtualRailLayout = installVirtualRailLayout();
    let unmount: (() => void) | undefined;
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      const items = Array.from({ length: 200 }, (_, index) => ({
        id: `item-${String(index)}`,
        label: `Client item ${String(index)}`,
        testId: `virtual-rail-row-${String(index)}`,
      }));

      ({ unmount } = render(
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
      ));

      await waitFor(() => {
        const rows = screen.getAllByTestId(/^virtual-rail-row-/);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThan(200);
      });
      expect(screen.queryByText('Client item 199')).toBeNull();
    } finally {
      try {
        await flushVirtualRailTimers();
      } finally {
        unmount?.();
        restoreVirtualRailLayout();
        vi.useRealTimers();
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
    expect(emailRow.getAttribute('aria-selected')).toBe('true');
    expect(emailRow.getAttribute('tabindex')).toBe('0');
    expect(notesRow.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(emailRow);

    fireEvent.keyDown(emailRow, { key: 'ArrowUp' });

    expect(notesRow.getAttribute('aria-selected')).toBe('true');
    expect(notesRow.getAttribute('tabindex')).toBe('0');
    expect(emailRow.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(notesRow);
  });

  it('moves keyboard focus with End-key selection in a virtualized rail', async () => {
    const restoreVirtualRailLayout = installVirtualRailLayout();
    let unmount: (() => void) | undefined;
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      const items = Array.from({ length: 200 }, (_, index) => ({
        id: `item-${String(index)}`,
        label: `Client item ${String(index)}`,
        testId: `virtual-focus-row-${String(index)}`,
      }));

      function VirtualKeyboardHarness() {
        const [activeId, setActiveId] = useState('item-0');
        return (
          <RailShell
            header={<RailShellHeader title="Client work" />}
            listAriaLabel="Client work"
            items={items}
            activeId={activeId}
            onSelect={setActiveId}
            virtualization={{ enabled: true, estimateSize: 44, overscan: 2 }}
          >
            <section>{activeId}</section>
          </RailShell>
        );
      }

      ({ unmount } = render(<VirtualKeyboardHarness />));

      await waitFor(() => {
        expect(screen.getAllByTestId(/^virtual-focus-row-/).length).toBeGreaterThan(0);
      });
      const firstRow = screen.getByTestId('virtual-focus-row-0');
      expect(screen.queryByTestId('virtual-focus-row-199')).toBeNull();
      firstRow.focus();

      fireEvent.keyDown(firstRow, { key: 'End' });
      const list = screen.getByRole('listbox', { name: 'Client work' });
      const virtualCanvas = list.firstElementChild as HTMLElement | null;
      list.scrollTop = Number.parseFloat(virtualCanvas?.style.height ?? '') || 1_000_000;
      fireEvent.scroll(list);

      await waitFor(() => {
        const lastRow = screen.getByTestId('virtual-focus-row-199');
        expect(lastRow.getAttribute('aria-selected')).toBe('true');
        expect(lastRow.getAttribute('tabindex')).toBe('0');
        expect(document.activeElement).toBe(lastRow);
      });
    } finally {
      try {
        await flushVirtualRailTimers();
      } finally {
        unmount?.();
        restoreVirtualRailLayout();
        vi.useRealTimers();
      }
    }
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
        createAction={(
          <RailShellActionMenu icon={Plus} label="Add email">
            <button type="button">New email</button>
          </RailShellActionMenu>
        )}
        menuAction={(
          <RailShellActionMenu icon={MoreVertical} label="More email actions">
            <button type="button">Filters</button>
          </RailShellActionMenu>
        )}
      />,
    );

    expect(screen.getByRole('button', { name: 'Add email' }).className).toContain('kp-icon-btn');
    expect(screen.getByRole('button', { name: 'More email actions' }).className).toContain('kp-icon-btn');
  });

  it('expands header search from an icon and collapses empty search on blur', () => {
    function HeaderHarness() {
      const [query, setQuery] = useState('');
      return (
        <>
          <RailShellHeader
            title="Emails"
            search={{
              value: query,
              onChange: setQuery,
              onClear: () => { setQuery(''); },
              placeholder: 'Search email',
              label: 'Search email',
              testId: 'rail-search',
            }}
          />
          <button type="button">Outside</button>
        </>
      );
    }

    render(<HeaderHarness />);

    expect(screen.queryByTestId('rail-search')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Search email' }));

    const field = screen.getByTestId('rail-search');
    expect(field).toBeTruthy();

    fireEvent.blur(field, { relatedTarget: screen.getByRole('button', { name: 'Outside' }) });

    expect(screen.queryByTestId('rail-search')).toBeNull();
  });
});
