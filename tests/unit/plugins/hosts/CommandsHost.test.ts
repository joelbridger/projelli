// Tests for CommandsHost.
//
// Coverage:
//  - handleRegisterCommand records the command in the registry store under
//    the owning plugin id, with optional title + category preserved
//  - handleRegisterCommand rejects an empty commandId with `invalid-args`
//  - handlesMethod is true only for `commands.invoke`
//  - handle('commands.invoke') looks up the command and delegates to the
//    invoker, returning whatever the invoker resolves with
//  - handle returns `not-found` when the command isn't registered
//  - handle returns `not-found` when no invoker is wired
//  - handle returns `invalid-args` for missing/blank commandId
//  - clearForPlugin (registry-level) removes only the targeted plugin's commands

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  CommandsHost,
  CommandsHostError,
} from '@/modules/plugins/hosts/CommandsHost';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';

beforeEach(() => {
  // Reset the Zustand store between tests so registrations don't bleed.
  usePluginRegistryStore.setState({
    commands: new Map(),
    toolbar: [],
    sidebar: [],
    settingsPages: [],
  });
});

describe('CommandsHost.handleRegisterCommand', () => {
  it('registers the command under the owning plugin with optional title + category', () => {
    const host = new CommandsHost();
    host.handleRegisterCommand('word-counter', 'word-counter.count', {
      title: 'Count words',
      category: 'Editing',
    });
    const cmd = usePluginRegistryStore.getState().commands.get('word-counter.count');
    expect(cmd).toBeDefined();
    expect(cmd?.pluginId).toBe('word-counter');
    expect(cmd?.title).toBe('Count words');
    expect(cmd?.category).toBe('Editing');
  });

  it('registers without title or category when not supplied', () => {
    const host = new CommandsHost();
    host.handleRegisterCommand('p', 'cmd.id', {});
    const cmd = usePluginRegistryStore.getState().commands.get('cmd.id');
    expect(cmd).toBeDefined();
    expect(cmd?.title).toBeUndefined();
    expect(cmd?.category).toBeUndefined();
  });

  it('is idempotent: a second registration with the same id replaces the first', () => {
    const host = new CommandsHost();
    host.handleRegisterCommand('p', 'cmd.id', { title: 'First' });
    host.handleRegisterCommand('p', 'cmd.id', { title: 'Second' });
    const cmd = usePluginRegistryStore.getState().commands.get('cmd.id');
    expect(cmd?.title).toBe('Second');
    expect(usePluginRegistryStore.getState().commands.size).toBe(1);
  });

  it('throws CommandsHostError(invalid-args) when commandId is empty', () => {
    const host = new CommandsHost();
    expect(() => host.handleRegisterCommand('p', '', {})).toThrow(CommandsHostError);
  });
});

describe('CommandsHost.handlesMethod', () => {
  it('returns true only for commands.invoke', () => {
    const host = new CommandsHost();
    expect(host.handlesMethod('commands.invoke')).toBe(true);
    expect(host.handlesMethod('commands.register')).toBe(false);
    expect(host.handlesMethod('storage.get')).toBe(false);
  });
});

describe('CommandsHost.handle (commands.invoke dispatch)', () => {
  it('delegates to the invoker and returns its resolved value', async () => {
    const invoker = vi.fn(async (_owner: string, _id: string, _payload: unknown) => 'count=42');
    const host = new CommandsHost({ commandInvoker: invoker });
    host.handleRegisterCommand('word-counter', 'word-counter.count', {});

    const result = await host.handle({
      pluginId: 'caller',
      method: 'commands.invoke',
      args: ['word-counter.count', { input: 'hello' }],
    });

    expect(result).toBe('count=42');
    expect(invoker).toHaveBeenCalledWith('word-counter', 'word-counter.count', { input: 'hello' });
  });

  it('throws not-found when the command is not registered', async () => {
    const host = new CommandsHost({ commandInvoker: vi.fn() });
    await expect(
      host.handle({ pluginId: 'caller', method: 'commands.invoke', args: ['nope'] }),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('throws not-found when no invoker is wired even if the command is registered', async () => {
    const host = new CommandsHost();
    host.handleRegisterCommand('owner', 'cmd.id', {});
    await expect(
      host.handle({ pluginId: 'caller', method: 'commands.invoke', args: ['cmd.id'] }),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('throws invalid-args when commandId is blank', async () => {
    const host = new CommandsHost({ commandInvoker: vi.fn() });
    await expect(
      host.handle({ pluginId: 'caller', method: 'commands.invoke', args: [''] }),
    ).rejects.toMatchObject({ code: 'invalid-args' });
    await expect(
      host.handle({ pluginId: 'caller', method: 'commands.invoke', args: [123] }),
    ).rejects.toMatchObject({ code: 'invalid-args' });
  });

  it('throws invalid-args when method is not commands.invoke', async () => {
    const host = new CommandsHost({ commandInvoker: vi.fn() });
    await expect(
      host.handle({ pluginId: 'caller', method: 'storage.get', args: ['x'] }),
    ).rejects.toMatchObject({ code: 'invalid-args' });
  });
});

describe('CommandsHost.setCommandInvoker', () => {
  it('replaces the invoker at runtime', async () => {
    const invokerA = vi.fn(async () => 'A');
    const invokerB = vi.fn(async () => 'B');
    const host = new CommandsHost({ commandInvoker: invokerA });
    host.handleRegisterCommand('p', 'cmd', {});

    expect(await host.handle({ pluginId: 'c', method: 'commands.invoke', args: ['cmd'] })).toBe('A');
    host.setCommandInvoker(invokerB);
    expect(await host.handle({ pluginId: 'c', method: 'commands.invoke', args: ['cmd'] })).toBe('B');
  });
});

describe('clearForPlugin (registry-level) leaves other plugins intact', () => {
  it('removes only the targeted plugin\'s commands', () => {
    const host = new CommandsHost();
    host.handleRegisterCommand('plugin-a', 'a.cmd1', {});
    host.handleRegisterCommand('plugin-a', 'a.cmd2', {});
    host.handleRegisterCommand('plugin-b', 'b.cmd1', {});

    usePluginRegistryStore.getState().clearForPlugin('plugin-a');
    const cmds = usePluginRegistryStore.getState().commands;
    expect(cmds.has('a.cmd1')).toBe(false);
    expect(cmds.has('a.cmd2')).toBe(false);
    expect(cmds.has('b.cmd1')).toBe(true);
  });
});
