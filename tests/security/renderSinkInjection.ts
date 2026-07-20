// Render-agnostic DOM-inertness detector for the render-sink hardening suite.
//
// This REPLICATES, byte-for-byte in its detection logic, the render-agnostic
// detector the markdown-preview (S2) lane exported from
// tests/security/markdown-preview-injection.test.ts (branch
// sec/markdown-preview-injection-c34). That file lives on an unmerged lane
// branch, so it could not be imported across the worktree boundary; the logic is
// copied verbatim and cited here so review can confirm the two are identical and
// the .docx / iframe / mermaid paths are held to the SAME inertness bar as the
// markdown path. Post-merge these should collapse to a single shared helper.
//
// `findInjections` / `runsCanary` inspect a produced DOM subtree (they do not
// know or care which renderer produced it), so the same detector settles the
// DocxViewer render, the iframe src guards, and mermaid strict-mode output.

import { expect } from 'vitest';

/**
 * Return a list of live-injection sinks found under `root` (an element whose
 * subtree is the produced DOM). Empty ⇒ inert.
 */
export function findInjections(root: ParentNode): string[] {
  const problems: string[] = [];

  // 1. No <script> elements.
  const scripts = root.querySelectorAll('script');
  if (scripts.length > 0) problems.push(`<script> element present (${scripts.length})`);

  // 1b. No <iframe>/<object>/<embed> (embedded-content execution surfaces).
  for (const tag of ['iframe', 'object', 'embed']) {
    const n = root.querySelectorAll(tag).length;
    if (n > 0) problems.push(`<${tag}> element present (${n})`);
  }

  const all = Array.from(root.querySelectorAll('*'));

  // 2. No on* event-handler attribute anywhere.
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) {
        problems.push(`event-handler attribute ${attr.name} on <${el.tagName.toLowerCase()}>`);
      }
    }
  }

  // 3. No dangerous URL scheme in any href/src/xlink:href. Normalize the way a
  //    browser does before scheme parsing (strip control chars + spaces,
  //    lower-case) so `java\tscript:` and ` javascript:` are caught.
  for (const el of all) {
    for (const name of ['href', 'src', 'xlink:href', 'poster', 'srcdoc']) {
      const raw = el.getAttribute(name);
      if (raw == null || raw === '') continue; // empty attribute = inert no-op
      if (name === 'srcdoc') {
        // srcdoc is embedded HTML — inherently an injection surface.
        problems.push(`srcdoc attribute present on <${el.tagName.toLowerCase()}>`);
        continue;
      }
      // eslint-disable-next-line no-control-regex -- intentionally matches control chars a browser ignores during scheme parsing (anti-obfuscation), mirroring the renderer allow-list
      const norm = raw.replace(/[\u0000-\u0020\u007F-\u009F]+/g, '').toLowerCase();
      // ALLOW-LIST check (mirrors the renderer): any scheme NOT positively
      // permitted is a problem. This catches block-list escapees too — blob:,
      // filesystem:, and any novel scheme — not just javascript:/vbscript:.
      const scheme = /^([a-z][a-z0-9+.-]*):/.exec(norm)?.[1];
      if (scheme === undefined) continue; // relative / anchor URL — allowed
      // An <img>/<source>/<video> src cannot execute script (not even SVG), so
      // an image sink additionally admits the NON-navigable data:/blob: forms a
      // real renderer emits (docx-preview embeds images as
      // data:application/octet-stream). The navigable href stays strict;
      // data:text/html / data:image/svg+xml on ANY attribute remain a problem.
      const isImageAttr = name === 'src' || name === 'poster' || name === 'xlink:href';
      const allowed =
        ['http', 'https', 'mailto', 'tel'].includes(scheme) ||
        /^data:image\/(png|jpe?g|gif|webp|avif|bmp);/.test(norm) ||
        (isImageAttr && (/^data:application\/octet-stream;/.test(norm) || scheme === 'blob'));
      if (!allowed) {
        problems.push(`non-allowlisted URL scheme in ${name}="${raw}"`);
      }
    }
  }

  return problems;
}

/**
 * Mount a clone of `root` into the live document, fire every event an injected
 * handler might listen for on every element, and report whether an attacker
 * canary executed. Belt-and-suspenders on top of findInjections' structural
 * check. `canaryKeys` are the window properties a payload would set.
 */
export function runsCanary(root: ParentNode, canaryKeys: string[]): boolean {
  const w = window as unknown as Record<string, unknown>;
  for (const k of canaryKeys) w[k] = 0;
  const host = document.createElement('div');
  // Move the actual produced nodes in (so live-DOM handlers, if any, are wired).
  for (const child of Array.from(root.childNodes)) host.appendChild(child.cloneNode(true));
  document.body.appendChild(host);
  try {
    const events = ['error', 'load', 'animationstart', 'mouseover', 'click', 'mouseenter'];
    for (const el of Array.from(host.querySelectorAll('*'))) {
      for (const type of events) {
        try {
          el.dispatchEvent(new Event(type, { bubbles: true }));
        } catch {
          /* jsdom may not construct every event type; ignore */
        }
      }
    }
    return canaryKeys.some((k) => Number(w[k] ?? 0) > 0);
  } finally {
    host.remove();
    for (const k of canaryKeys) w[k] = 0;
  }
}

/** One assertion used everywhere: the produced subtree must be inert. */
export function expectDomInert(root: ParentNode, canaryKeys: string[], context = ''): void {
  const problems = findInjections(root);
  expect(
    problems,
    `${context}\nproduced HTML:\n${(root as Element).innerHTML ?? ''}\ninjection sinks:\n${problems.join('\n')}`,
  ).toEqual([]);
  expect(runsCanary(root, canaryKeys), `${context} — canary executed`).toBe(false);
}
