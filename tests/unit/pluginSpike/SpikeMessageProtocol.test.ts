import { describe, it, expect } from 'vitest';

import type { SpikeMessage } from '@/types/pluginSpike';
import { decode, encode, isSpikeMessage } from '@/modules/pluginSpike/SpikeMessageProtocol';

describe('SpikeMessageProtocol', () => {
  describe('encode / decode round-trip', () => {
    it('round-trips an init message', () => {
      const msg: SpikeMessage = {
        id: 'm1',
        type: 'init',
        pluginCode: 'export const activate = () => {};',
        permissions: ['editor:selection'],
      };
      expect(decode(encode(msg))).toEqual(msg);
    });

    it('round-trips a register-command message', () => {
      const msg: SpikeMessage = { id: 'm2', type: 'register-command', commandId: 'criterion-1' };
      expect(decode(encode(msg))).toEqual(msg);
    });

    it('round-trips an invoke-command message with payload', () => {
      const msg: SpikeMessage = {
        id: 'm3',
        type: 'invoke-command',
        commandId: 'criterion-7',
        payload: { mode: 'sync-throw' },
      };
      expect(decode(encode(msg))).toEqual(msg);
    });

    it('round-trips a command-result message', () => {
      const msg: SpikeMessage = {
        id: 'm4',
        type: 'command-result',
        inResponseTo: 'm3',
        result: { ok: true, value: 'hello' },
      };
      expect(decode(encode(msg))).toEqual(msg);
    });

    it('round-trips an api-call message', () => {
      const msg: SpikeMessage = {
        id: 'm5',
        type: 'api-call',
        method: 'editor.getSelection',
        args: [],
      };
      expect(decode(encode(msg))).toEqual(msg);
    });

    it('round-trips an api-result message', () => {
      const msg: SpikeMessage = {
        id: 'm6',
        type: 'api-result',
        inResponseTo: 'm5',
        result: 'selected text',
      };
      expect(decode(encode(msg))).toEqual(msg);
    });

    it('round-trips a panel-render message', () => {
      const msg: SpikeMessage = {
        id: 'm7',
        type: 'panel-render',
        spec: { id: 'spike-panel', title: 'Spike', html: '<p>hello</p>' },
      };
      expect(decode(encode(msg))).toEqual(msg);
    });

    it('round-trips a notify message', () => {
      const msg: SpikeMessage = { id: 'm8', type: 'notify', level: 'info', message: 'hi' };
      expect(decode(encode(msg))).toEqual(msg);
    });

    it('round-trips an error message', () => {
      const msg: SpikeMessage = {
        id: 'm9',
        type: 'error',
        inResponseTo: 'm5',
        error: { code: 'permission-denied', message: 'missing editor:selection' },
      };
      expect(decode(encode(msg))).toEqual(msg);
    });
  });

  describe('encode rejects invalid input', () => {
    it('rejects null', () => {
      expect(() => encode(null as unknown as SpikeMessage)).toThrow(/must be an object/);
    });

    it('rejects missing id', () => {
      expect(() =>
        encode({ type: 'notify', level: 'info', message: 'x' } as unknown as SpikeMessage),
      ).toThrow(/id must be a string/);
    });

    it('rejects unknown type', () => {
      expect(() =>
        encode({ id: 'x', type: 'bogus' } as unknown as SpikeMessage),
      ).toThrow(/unknown message type/);
    });
  });

  describe('decode rejects invalid input', () => {
    it('rejects non-string raw', () => {
      expect(() => decode(42 as unknown as string)).toThrow(/must be a string/);
    });

    it('rejects malformed JSON', () => {
      expect(() => decode('{not json')).toThrow(/invalid JSON/);
    });

    it('rejects JSON arrays', () => {
      expect(() => decode('[1,2,3]')).toThrow(/must be an object/);
    });

    it('rejects JSON null', () => {
      expect(() => decode('null')).toThrow(/must be an object/);
    });

    it('rejects missing id', () => {
      expect(() => decode(JSON.stringify({ type: 'notify' }))).toThrow(/id must be a string/);
    });

    it('rejects unknown type', () => {
      expect(() => decode(JSON.stringify({ id: 'x', type: 'totally-not-real' }))).toThrow(
        /unknown message type/,
      );
    });

    it('rejects numeric id', () => {
      expect(() => decode(JSON.stringify({ id: 1, type: 'notify' }))).toThrow(/id must be a string/);
    });
  });

  describe('isSpikeMessage', () => {
    it('accepts a well-formed message', () => {
      expect(isSpikeMessage({ id: 'x', type: 'notify', level: 'info', message: 'y' })).toBe(true);
    });

    it('rejects non-objects', () => {
      expect(isSpikeMessage('string')).toBe(false);
      expect(isSpikeMessage(null)).toBe(false);
      expect(isSpikeMessage(undefined)).toBe(false);
    });

    it('rejects unknown types', () => {
      expect(isSpikeMessage({ id: 'x', type: 'nope' })).toBe(false);
    });

    it('rejects missing id', () => {
      expect(isSpikeMessage({ type: 'notify' })).toBe(false);
    });
  });
});
