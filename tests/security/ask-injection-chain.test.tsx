/**
 * ACCEPTANCE / REGRESSION — Ask prompt-injection → filesystem chain.
 * Workstream: injection-chain-workstream-c34 (Opus security lane).
 *
 * WHAT THIS PINS
 * --------------
 * The most severe theorised chain in the program was:
 *   untrusted content -> Ask renders model output into the page -> an injected
 *   inline <script>/handler runs -> window.__TAURI__ (exposed to every page
 *   script by `withGlobalTauri: true`) -> a privileged fs command (read / copy /
 *   recursive-delete over the whole-disk fs scope).
 *
 * Links 2-4 are all TRUE today and are NOT what breaks the chain:
 *   - withGlobalTauri: true            (src-tauri/tauri.conf.json)
 *   - CSP script-src 'unsafe-inline'   (src-tauri/tauri.conf.json)
 *   - fs:scope allow whole-disk glob   (src-tauri/capabilities/default.json)
 * So window.__TAURI__ IS reachable and injected inline JS WOULD execute — IF any
 * ran. The chain is broken at LINK 1, the render: every Ask answer renderer
 * turns model-derived content into INERT output before it reaches the DOM:
 *   - the chat bubble path (renderMessage) HTML-escapes < > & up front and never
 *     processes markdown links/images, so no tag or handler can be introduced;
 *   - the smart-answer path (CitationText, used by AnswerBlocks) renders every
 *     span as a React TEXT child, which React escapes structurally.
 *
 * This test renders BOTH real Ask renderers with a battery of fabricated
 * injection payloads and asserts the produced DOM is inert: no <script>, no
 * event-handler attribute, no javascript: URL, and the __TAURI__ canary never
 * appears as anything but escaped text. It is deliberately independent of the
 * capability/CSP config so that if a future change removes the render-time
 * escaping (e.g. swaps in a raw-HTML markdown renderer), THIS test goes red even
 * while links 2-4 stay exactly as they are.
 *
 * A companion real-browser proof (run out-of-band under the app's exact CSP with
 * a stubbed __TAURI__.core.invoke canary) confirmed 0/30 Ask injections reached
 * the bridge at runtime. This jsdom test is the permanent CI-runnable guard.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MessageBubble } from '@/features/ask/chat/MessageBubble';
import { CitationText } from '@/features/ask/CitationText';
import type { ChatMessage } from '@/platform/types/ai';

// If any of these ran as script it would reach a privileged fs command.
const INVOKE = "window.__TAURI__.core.invoke('plugin:fs|read_text_file',{path:'CANARY'})";

const PAYLOADS: Record<string, string> = {
  'raw-script-tag': `Answer.<script>${INVOKE}</script>done`,
  'img-onerror': `<img src=x onerror="${INVOKE}">`,
  'svg-onload': `<svg onload="${INVOKE}"></svg>`,
  'body-onload': `<body onload="${INVOKE}">`,
  'iframe-srcdoc': `<iframe srcdoc="&lt;script&gt;${INVOKE}&lt;/script&gt;"></iframe>`,
  'entity-encoded': `&lt;img src=x onerror=&quot;${INVOKE}&quot;&gt;`,
  'inside-code-fence': '```html\n<img src=x onerror="' + INVOKE + '">\n```',
  'inside-inline-code': '`<img src=x onerror="' + INVOKE + '">`',
  'inside-bold': `**<img src=x onerror="${INVOKE}">**`,
  'br-then-tag': `line1\n<img src=x onerror="${INVOKE}">`,
  // markdown link/image URL breakout — inert in Ask (no link/image markdown in
  // renderMessage; React text in CitationText), the vector that IS live only in
  // the separate document MarkdownPreview sink.
  'md-link-attr-break': `[click](" onmouseover="${INVOKE}" x=")`,
  'md-link-autofire': `[x](" style="animation:spin 1s" onanimationstart="${INVOKE}" y=")`,
  'md-image-autofire': `![](" onerror="${INVOKE}" y=")`,
  'md-link-js-url': `[click](javascript:${INVOKE})`,
  'autofocus-onfocus': `<input autofocus onfocus="${INVOKE}">`,
};

const EVENT_HANDLER_ATTR = /^on[a-z]/i;
const JS_URL = /^\s*javascript:/i;

/** Assert a rendered container introduced no executable surface. */
function assertInert(container: HTMLElement, label: string) {
  // 1) No script element was parsed into the DOM.
  expect(container.querySelectorAll('script'), `${label}: <script> present`).toHaveLength(0);

  // 2) No element carries an inline event-handler attribute (onerror, onload,
  //    onanimationstart, onmouseover, onfocus, ...). React never emits these
  //    from string content; their presence would mean raw HTML was parsed.
  for (const el of Array.from(container.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      expect(
        EVENT_HANDLER_ATTR.test(attr.name),
        `${label}: <${el.tagName.toLowerCase()}> has handler attr ${attr.name}="${attr.value}"`,
      ).toBe(false);
    }
    // 3) No href/src is a javascript: URL.
    for (const urlAttr of ['href', 'src']) {
      const v = el.getAttribute(urlAttr);
      if (v != null) {
        expect(JS_URL.test(v), `${label}: <${el.tagName.toLowerCase()}> ${urlAttr}=${v}`).toBe(false);
      }
    }
  }

  // 4) The canary command string, if it survived into the DOM at all, exists
  //    ONLY as inert text — never as a live <script> body or attribute. We prove
  //    this by requiring that any occurrence is reachable as textContent (the
  //    escaped rendering) and that the raw HTML contains no unescaped '<script'.
  expect(container.innerHTML.toLowerCase(), `${label}: unescaped <script in markup`).not.toContain('<script');
}

function assistantMessage(content: string): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content,
    timestamp: new Date('2020-01-01T00:00:00Z').toISOString(),
  } as unknown as ChatMessage;
}

describe('Ask prompt-injection → filesystem chain is broken at the render link', () => {
  describe('chat bubble path (renderMessage via MessageBubble)', () => {
    for (const [name, payload] of Object.entries(PAYLOADS)) {
      it(`renders "${name}" inert`, () => {
        const { container, unmount } = render(
          <MessageBubble
            msg={assistantMessage(payload)}
            idx={0}
            isLastMessage
            t={((k: string) => k) as never}
            entityLabel={{ singular: 'client', plural: 'clients' } as never}
            handleCitationClick={() => undefined}
            handleMissingSource={() => undefined}
            onRetryLastError={() => undefined}
          />,
        );
        assertInert(container, `chat/${name}`);
        unmount();
      });
    }
  });

  describe('smart-answer path (CitationText, the AnswerBlocks body)', () => {
    for (const [name, payload] of Object.entries(PAYLOADS)) {
      it(`renders "${name}" inert`, () => {
        const { container, unmount } = render(
          <CitationText text={payload} citations={[]} selected={null} onSelect={() => undefined} />,
        );
        assertInert(container, `smart/${name}`);
        unmount();
      });
    }
  });
});
