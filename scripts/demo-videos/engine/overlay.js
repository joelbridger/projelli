/**
 * overlay.js — injected into the recorded page (via page.addInitScript).
 *
 * Playwright's real mouse leaves no visible pointer in a video recording, so
 * we draw our own: a smooth, eased cursor plus a click ripple and a caption
 * bar. The Node engine (DemoEngine.mjs) positions this fake cursor over each
 * target's real coordinates, then fires the real Playwright click at the same
 * spot — so what the viewer sees (the drawn cursor) and what actually happens
 * (the real click) always line up.
 *
 * Everything here is plain DOM + requestAnimationFrame so it is captured
 * frame-for-frame by Playwright's video. pointer-events are disabled so the
 * overlay never intercepts the real clicks.
 *
 * This script re-runs on every navigation (addInitScript semantics); it is
 * idempotent — a second run reuses the existing nodes.
 */
(() => {
  if (window.__demo && window.__demo.__installed) return;

  const NS = 'http://www.w3.org/2000/svg';
  const state = {
    x: window.innerWidth / 2,
    y: window.innerHeight * 0.62,
  };

  // ---- cursor ----------------------------------------------------------
  const cursor = document.createElement('div');
  cursor.setAttribute('data-demo-cursor', '');
  Object.assign(cursor.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: '28px',
    height: '28px',
    zIndex: '2147483647',
    pointerEvents: 'none',
    transform: `translate(${state.x}px, ${state.y}px)`,
    transition: 'none',
    willChange: 'transform',
    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.35))',
  });
  // A crisp macOS-style arrow pointer.
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 28 28');
  svg.setAttribute('width', '28');
  svg.setAttribute('height', '28');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute(
    'd',
    'M6 4 L6 22 L11 17.5 L14 24 L17.5 22.5 L14.5 16 L21 16 Z'
  );
  path.setAttribute('fill', '#111827');
  path.setAttribute('stroke', '#ffffff');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  cursor.appendChild(svg);

  // ---- caption bar -----------------------------------------------------
  const caption = document.createElement('div');
  caption.setAttribute('data-demo-caption', '');
  Object.assign(caption.style, {
    position: 'fixed',
    left: '50%',
    // The engine chooses the safe edge for every beat: captions describing a
    // target in the lower 40% sit at the top, and all others sit at the
    // bottom. `top` is the single animated anchor so an edge change is smooth.
    top: '94%',
    transform: 'translateX(-50%) translateY(calc(-100% + 12px))',
    // A single generous line, about 82% of the frame including its padding.
    // Captions are deliberately kept short in flows so this never becomes a
    // two-line block over the product.
    width: '82%',
    maxWidth: '1050px',
    boxSizing: 'border-box',
    whiteSpace: 'nowrap',
    padding: '18px 32px',
    borderRadius: '18px',
    background: 'rgba(17, 24, 39, 0.68)',
    color: '#ffffff',
    // At the 2560px final render this remains huge while leaving room for a
    // calm, single-line sentence.
    font: "600 44px/1.18 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    textAlign: 'center',
    letterSpacing: '0',
    zIndex: '2147483646',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 320ms ease, top 320ms ease, transform 320ms ease',
    boxShadow: '0 8px 30px rgba(0,0,0,0.28)',
  });

  function mount() {
    const root = document.body || document.documentElement;
    if (cursor.parentNode !== root) root.appendChild(cursor);
    if (caption.parentNode !== root) root.appendChild(caption);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
  // Recording pages sometimes re-render the body; keep the overlay on top.
  setInterval(mount, 500);

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const easeInOutCubic = (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  function render() {
    cursor.style.transform = `translate(${state.x}px, ${state.y}px)`;
  }

  // Eased glide to (x, y) over `duration` ms. Resolves when it arrives.
  function moveTo(x, y, duration = 850) {
    return new Promise((resolve) => {
      const sx = state.x;
      const sy = state.y;
      const tx = clamp(x, 2, window.innerWidth - 2);
      const ty = clamp(y, 2, window.innerHeight - 2);
      const dist = Math.hypot(tx - sx, ty - sy);
      const dur = dist < 6 ? 0 : duration;
      if (dur === 0) {
        state.x = tx;
        state.y = ty;
        render();
        resolve();
        return;
      }
      const start = performance.now();
      function frame(now) {
        const p = clamp((now - start) / dur, 0, 1);
        const e = easeInOutCubic(p);
        state.x = sx + (tx - sx) * e;
        state.y = sy + (ty - sy) * e;
        render();
        if (p < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  // Quick press-down feedback on the cursor.
  function press() {
    return new Promise((resolve) => {
      cursor.style.transition = 'transform 90ms ease';
      const base = `translate(${state.x}px, ${state.y}px)`;
      cursor.style.transform = `${base} scale(0.82)`;
      setTimeout(() => {
        cursor.style.transform = base;
        setTimeout(() => {
          cursor.style.transition = 'none';
          resolve();
        }, 110);
      }, 110);
    });
  }

  // Expanding fading ring at the current cursor tip.
  function ripple() {
    const r = document.createElement('div');
    const size = 14;
    Object.assign(r.style, {
      position: 'fixed',
      left: `${state.x}px`,
      top: `${state.y}px`,
      width: `${size}px`,
      height: `${size}px`,
      marginLeft: `${-size / 2}px`,
      marginTop: `${-size / 2}px`,
      borderRadius: '50%',
      border: '2px solid rgba(220, 38, 38, 0.9)',
      background: 'rgba(220, 38, 38, 0.18)',
      zIndex: '2147483645',
      pointerEvents: 'none',
      transform: 'scale(0.4)',
      opacity: '0.9',
      transition:
        'transform 480ms cubic-bezier(0.2,0.7,0.3,1), opacity 480ms ease',
    });
    (document.body || document.documentElement).appendChild(r);
    requestAnimationFrame(() => {
      r.style.transform = 'scale(3.2)';
      r.style.opacity = '0';
    });
    setTimeout(() => r.remove(), 520);
  }

  function captionTransform(position, offset = 0) {
    return position === 'top'
      ? `translateX(-50%) translateY(${offset}px)`
      : `translateX(-50%) translateY(calc(-100% + ${offset}px))`;
  }

  function showCaption(text, position = 'bottom') {
    caption.textContent = text;
    caption.style.top = position === 'top' ? '8%' : '94%';
    caption.style.opacity = '1';
    caption.style.transform = captionTransform(position);
  }
  function hideCaption() {
    caption.style.opacity = '0';
    const position = parseFloat(caption.style.top || '94') < 50 ? 'top' : 'bottom';
    caption.style.transform = captionTransform(position, position === 'top' ? -12 : 12);
  }

  render();

  window.__demo = {
    __installed: true,
    moveTo,
    press,
    ripple,
    showCaption,
    hideCaption,
    pos: () => ({ x: state.x, y: state.y }),
    place: (x, y) => {
      state.x = x;
      state.y = y;
      render();
    },
  };
})();
