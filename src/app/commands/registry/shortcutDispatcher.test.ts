import { describe, expect, it, vi } from 'vitest';
import { getCommandDescriptors } from '@/app/commands/registry/commandRegistry';
import {
  dispatchKeyboardShortcut,
  getShortcutCommandDescriptors,
  getSurfaceShortcutDescriptors,
  normalizeShortcut,
} from '@/app/commands/registry/shortcutDispatcher';
import type {
  CommandDescriptor,
  CommandRuntime,
} from '@/app/commands/registry/types';

function runtime(overrides: Partial<CommandRuntime> = {}): CommandRuntime {
  return {
    openTabs: [],
    activeTabPath: null,
    isSplit: false,
    sidebarActiveTab: 'home',
    ...overrides,
  };
}

function keyEvent(
  key: string,
  init: KeyboardEventInit = {},
  target?: HTMLElement
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    cancelable: true,
    ...init,
  });
  if (target) Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('shortcutDispatcher', () => {
  it('normalizes Ctrl and Command to one cross-platform modifier', () => {
    expect(normalizeShortcut('Ctrl+Shift+P')).toBe('mod+shift+p');
    expect(normalizeShortcut('Cmd+Shift+P')).toBe('mod+shift+p');
  });

  it('derives numeric jumps from primary app-surface order', () => {
    expect(
      getSurfaceShortcutDescriptors().map(({ shortcut, id }) => [shortcut, id])
    ).toEqual([
      ['Ctrl+1', 'surface.jump.home.numeric'],
      ['Ctrl+2', 'surface.jump.matters.numeric'],
      ['Ctrl+3', 'surface.jump.search.numeric'],
    ]);
  });

  it('dispatches a numeric surface jump without a central key map', async () => {
    const setSidebarActiveTab = vi.fn();
    const event = keyEvent('1', { metaKey: true });
    const consumed = await dispatchKeyboardShortcut(
      event,
      runtime({ setSidebarActiveTab }),
      getShortcutCommandDescriptors(getCommandDescriptors())
    );

    expect(consumed).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(setSidebarActiveTab).toHaveBeenCalledExactlyOnceWith('home');
  });

  it('ignores editable targets unless the descriptor explicitly opts in', async () => {
    const execute = vi.fn();
    const input = document.createElement('input');
    const blocked: CommandDescriptor = {
      id: 'blocked',
      labelKey: 'test.blocked',
      category: 'test',
      shortcut: 'Ctrl+N',
      execute,
    };
    const event = keyEvent('n', { ctrlKey: true }, input);

    expect(await dispatchKeyboardShortcut(event, runtime(), [blocked])).toBe(
      false
    );
    expect(execute).not.toHaveBeenCalled();

    const allowed = { ...blocked, id: 'allowed', allowInEditable: true };
    expect(
      await dispatchKeyboardShortcut(
        keyEvent('n', { ctrlKey: true }, input),
        runtime(),
        [allowed]
      )
    ).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
  });
});
