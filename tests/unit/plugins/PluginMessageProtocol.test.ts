import { describe, it, expect } from 'vitest';
import {
  encode,
  decode,
  isPluginMessage,
  type PluginMessage,
} from '@/modules/plugins/PluginMessageProtocol';

/**
 * Build one canonical valid instance of every message variant. The
 * round-trip test below iterates this list so adding a new variant means
 * adding a fixture here and nothing else.
 */
const MESSAGES: PluginMessage[] = [
  {
    id: 'm-1',
    type: 'init',
    pluginId: 'translator',
    version: '1.0.0',
    pluginCode: 'export default { activate(){} }',
    permissions: ['workspace:read', 'ai:invoke'],
  },
  {
    id: 'm-2',
    type: 'register-command',
    commandId: 'translator.translate',
    title: 'Translate',
    category: 'Writing',
  },
  {
    id: 'm-3',
    type: 'invoke-command',
    commandId: 'translator.translate',
    payload: { language: 'es' },
  },
  {
    id: 'm-4',
    type: 'command-result',
    inResponseTo: 'm-3',
    result: { translated: 'hola' },
  },
  {
    id: 'm-5',
    type: 'api-call',
    method: 'editor.getSelection',
    args: [],
  },
  {
    id: 'm-6',
    type: 'api-result',
    inResponseTo: 'm-5',
    result: { text: 'hello', range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 } },
  },
  {
    id: 'm-7',
    type: 'error',
    inResponseTo: 'm-5',
    error: { code: 'permission-denied', message: 'editor:selection not granted' },
  },
  {
    id: 'm-8',
    type: 'panel-render',
    panelId: 'translator.panel',
    html: '<div>Translator</div>',
  },
  {
    id: 'm-9',
    type: 'toolbar-add',
    spec: { id: 'translator.btn', icon: 'languages', tooltip: 'Translate', command: 'translator.translate' },
  },
  {
    id: 'm-10',
    type: 'toolbar-remove',
    buttonId: 'translator.btn',
  },
  {
    id: 'm-11',
    type: 'sidebar-add-panel',
    spec: { id: 'translator.panel', title: 'Translator', html: '<div/>' },
  },
  {
    id: 'm-12',
    type: 'sidebar-remove-panel',
    panelId: 'translator.panel',
  },
  {
    id: 'm-13',
    type: 'settings-add-page',
    spec: {
      id: 'translator.settings',
      title: 'Translator',
      schema: {
        targetLanguage: { type: 'string', default: 'Spanish', label: 'Target language' },
      },
    },
  },
  {
    id: 'm-14',
    type: 'notify',
    level: 'warn',
    message: 'Select some text first',
  },
];

describe('PluginMessageProtocol encode + decode', () => {
  it.each(MESSAGES.map((m) => [m.type, m] as const))(
    'round-trips %s without losing fields',
    (_type, msg) => {
      const wire = encode(msg);
      expect(typeof wire).toBe('string');
      const decoded = decode(wire);
      expect(decoded).toEqual(msg);
    },
  );

  it('covers every variant defined in the union', () => {
    const seen = new Set(MESSAGES.map((m) => m.type));
    const expected = [
      'init',
      'register-command',
      'invoke-command',
      'command-result',
      'api-call',
      'api-result',
      'error',
      'panel-render',
      'toolbar-add',
      'toolbar-remove',
      'sidebar-add-panel',
      'sidebar-remove-panel',
      'settings-add-page',
      'notify',
    ];
    for (const t of expected) {
      expect(seen.has(t as PluginMessage['type'])).toBe(true);
    }
  });
});

describe('PluginMessageProtocol.encode validation', () => {
  it('rejects null / non-object input', () => {
    expect(() => encode(null as unknown as PluginMessage)).toThrow();
    expect(() => encode(42 as unknown as PluginMessage)).toThrow();
    expect(() => encode('string' as unknown as PluginMessage)).toThrow();
  });

  it('rejects an unknown message type', () => {
    const bogus = { id: 'x', type: 'mystery' } as unknown as PluginMessage;
    expect(() => encode(bogus)).toThrow(/unknown message type/);
  });

  it('rejects a missing or non-string id', () => {
    const noId = { type: 'notify', level: 'info', message: 'hi' } as unknown as PluginMessage;
    expect(() => encode(noId)).toThrow(/id must be a string/);
  });
});

describe('PluginMessageProtocol.decode validation', () => {
  it('rejects non-string input', () => {
    expect(() => decode({} as unknown)).toThrow();
    expect(() => decode(null)).toThrow();
    expect(() => decode(42)).toThrow();
  });

  it('rejects malformed JSON', () => {
    expect(() => decode('{ not json')).toThrow(/invalid JSON/);
  });

  it('rejects JSON arrays at the top level', () => {
    expect(() => decode('[]')).toThrow(/must be an object/);
  });

  it('rejects an unknown type', () => {
    expect(() => decode(JSON.stringify({ id: 'x', type: 'mystery' }))).toThrow(/unknown message type/);
  });

  it('rejects non-string id', () => {
    expect(() => decode(JSON.stringify({ id: 42, type: 'notify', level: 'info', message: 'hi' }))).toThrow(
      /id must be a string/,
    );
  });
});

describe('isPluginMessage type guard', () => {
  it('returns true for every canonical fixture', () => {
    for (const msg of MESSAGES) {
      expect(isPluginMessage(msg)).toBe(true);
    }
  });

  it('returns false for plainly invalid values', () => {
    expect(isPluginMessage(null)).toBe(false);
    expect(isPluginMessage(undefined)).toBe(false);
    expect(isPluginMessage('string')).toBe(false);
    expect(isPluginMessage(42)).toBe(false);
    expect(isPluginMessage([])).toBe(false);
    expect(isPluginMessage({})).toBe(false);
    expect(isPluginMessage({ id: 'x' })).toBe(false);
    expect(isPluginMessage({ id: 'x', type: 'mystery' })).toBe(false);
    expect(isPluginMessage({ type: 'notify' })).toBe(false);
    expect(isPluginMessage({ id: 42, type: 'notify' })).toBe(false);
  });

  it('correctly discriminates by type', () => {
    const msg: unknown = { id: 'm-x', type: 'api-call', method: 'editor.getContent', args: [] };
    if (isPluginMessage(msg)) {
      expect(msg.type).toBe('api-call');
      if (msg.type === 'api-call') {
        expect(msg.method).toBe('editor.getContent');
        expect(Array.isArray(msg.args)).toBe(true);
      }
    } else {
      expect.fail('isPluginMessage should have accepted the value');
    }
  });
});
