import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs pure-logic module, no d.ts
import { pathBucket, cssTier, uiCodeTier } from '../../../scripts/ui-system/lib/classify.mjs';

describe('classify-tier: path buckets', () => {
  it('routes behaviour layers to B by path', () => {
    expect(pathBucket('src/platform/providers/ClaudeProvider.ts')).toBe('B');
    expect(pathBucket('src-tauri/src/commands/mail.rs')).toBe('B');
    expect(pathBucket('src/features/ask/askStore.ts')).toBe('B'); // *Store.ts
  });
  it('routes UI code, css, copy, assets', () => {
    expect(pathBucket('src/features/ask/Ask.tsx')).toBe('UICODE');
    expect(pathBucket('src/ui/kp/Button.tsx')).toBe('UICODE');
    expect(pathBucket('src/styles/globals.css')).toBe('CSS');
    expect(pathBucket('src/locales/en.json')).toBe('COPY');
    expect(pathBucket('brand/brand.config.json')).toBe('PAINT-ASSET');
    expect(pathBucket('public/logo.svg')).toBe('PAINT-ASSET');
    expect(pathBucket('docs/x.md')).toBe('NONE');
  });
});

describe('classify-tier: CSS content (P-safe vs P-risky→S)', () => {
  it('token value swaps are P-safe', () => {
    expect(cssTier(['  --kp-navy: #123456;', '  color: #fff;'])).toBe('P-safe');
  });
  it('behaviour-adjacent CSS escalates to S', () => {
    expect(cssTier(['  display: none;'])).toBe('S');
    expect(cssTier(['  pointer-events: none;'])).toBe('S');
    expect(cssTier(['.kp-overlay:hover { opacity: 0; }'])).toBe('S');
    expect(cssTier(['@media (max-width: 700px) {'])).toBe('S');
    expect(cssTier(['  z-index: 5;'])).toBe('S');
  });
});

describe('classify-tier: UI code content (S vs B)', () => {
  it('pure markup / structure stays S', () => {
    expect(uiCodeTier(['<div className="card">hello</div>'])).toBe('S');
    expect(uiCodeTier(['  <span>{t("ask.title")}</span>'])).toBe('S');
    expect(uiCodeTier(['  className={cn("kp-btn", active && "is-active")}'])).toBe('S');
  });

  // Round-2 review: THESE were misclassified as S and must be B.
  it('a handler REBIND is B (review case)', () => {
    expect(uiCodeTier(['-      <button onClick={connect}>', '+      <button onClick={disconnect}>'].map((l) => l.slice(1)))).toBe('B');
    expect(uiCodeTier(['      <button onClick={disconnect}>'])).toBe('B');
  });
  it('a disabled-state change is B (review case)', () => {
    expect(uiCodeTier(['        disabled={canSend}'])).toBe('B');
    expect(uiCodeTier(['        disabled={false}'])).toBe('B');
    expect(uiCodeTier(['        aria-disabled={busy}'])).toBe('B');
  });
  it('href / form action / submit type are B (review case)', () => {
    expect(uiCodeTier(['        href="/pricing"'])).toBe('B');
    expect(uiCodeTier(['      <form action={onSubmit}>'])).toBe('B');
    expect(uiCodeTier(['        type="submit"'])).toBe('B');
  });
  it('hooks / async / invoke / platform import are B', () => {
    expect(uiCodeTier(['  const [s, set] = useState(0);'])).toBe('B');
    expect(uiCodeTier(['  await invoke("capture_start");'])).toBe('B');
    expect(uiCodeTier(["  import { x } from '@/platform/providers/Provider';"])).toBe('B');
  });
});
