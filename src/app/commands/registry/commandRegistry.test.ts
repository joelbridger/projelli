import { describe, expect, it } from 'vitest';
import {
  commandRegistry,
  getCommandDescriptors,
  validateCommandDescriptors,
} from '@/app/commands/registry/commandRegistry';
import type { CommandDescriptor } from '@/app/commands/registry/types';

function descriptor(
  overrides: Partial<CommandDescriptor> = {}
): CommandDescriptor {
  return {
    id: 'example.command',
    labelKey: 'commands.file.save',
    category: 'example',
    execute: () => undefined,
    ...overrides,
  };
}

describe('commandRegistry', () => {
  it('is the complete source for current app commands', () => {
    expect(commandRegistry).toHaveLength(16);
    expect(getCommandDescriptors().map(({ id }) => id)).toEqual([
      'file.new-document',
      'file.save',
      'file.close',
      'view.outline',
      'view.sidebar',
      'view.tabOverflow',
      'view.split',
      'workspace.change',
      'view.aiAssistant',
      'open-settings',
      'browser.open',
      'palette.open',
      'palette.open-alternate',
      'quick-open.open',
      'shortcuts.open',
      'history.undo-last-file-operation',
    ]);
  });

  it('rejects duplicate command ids', () => {
    expect(() => {
      validateCommandDescriptors([descriptor(), descriptor()]);
    }).toThrow('duplicate command id: example.command');
  });

  it('rejects duplicate normalized shortcuts', () => {
    expect(() => {
      validateCommandDescriptors([
        descriptor({ id: 'one', shortcut: 'Ctrl+Shift+P' }),
        descriptor({ id: 'two', shortcut: 'cmd+shift+p' }),
      ]);
    }).toThrow('duplicate shortcut: cmd+shift+p');
  });

  it('rejects label keys without a translation namespace', () => {
    expect(() => {
      validateCommandDescriptors([descriptor({ labelKey: 'command' })]);
    }).toThrow('labelKey must include a namespace: example.command');
  });

  it('rejects label keys missing from the English catalog', () => {
    expect(() => {
      validateCommandDescriptors([
        descriptor({ labelKey: 'commands.file.not-a-real-command' }),
      ]);
    }).toThrow(
      'labelKey does not resolve in en catalog: commands.file.not-a-real-command (example.command)'
    );
  });
});
