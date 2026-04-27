/* Hero animation — vanilla JS state machine (no React, no build step).
 * Modeled on BehaviorUX's BehaviorDemoHero.tsx pattern: a precomputed
 * timing schedule + RAF tick that updates DOM/classes per phase.
 *
 * All content (file names, message text, markdown chunks) is hardcoded
 * in this file. We build DOM via createElement / textContent — no
 * innerHTML — so there's no XSS surface even though the inputs are
 * fully trusted.
 *
 * Story (~22s, then loops):
 *   t=0.0  — workspace settled, file tree visible, Linterly tabs (Launch Plan)
 *   t=1.5  — cursor moves to chat input
 *   t=2.0  — types "Draft a brand voice guide for Linterly" char-by-char
 *   t=6.5  — cursor moves to send button + clicks
 *   t=7.0  — user message bubble appears; thinking dots
 *   t=8.0  — AI streams a response in chunks (markdown-ish)
 *   t=12.5 — Brand Voice.md pops into the file tree
 *   t=15.0 — cursor moves to Brand Voice.md in tree
 *   t=15.5 — clicks; new tab opens; editor view shown with rendered MD
 *   t=20.0 — hold final state
 *   t=22.0 — reset and loop
 */
(function () {
  var root = document.getElementById('hero-anim');
  if (!root) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  // DOM refs (all elements set up in the markup with data-anim attributes)
  var inputText  = root.querySelector('[data-anim="input-text"]');
  var inputCaret = root.querySelector('[data-anim="input-caret"]');
  var messages   = root.querySelector('[data-anim="messages"]');
  var fileTree   = root.querySelector('[data-anim="file-tree"]');
  var tabsEl     = root.querySelector('[data-anim="tabs"]');
  var chatPane   = root.querySelector('[data-anim="pane-chat"]');
  var editorPane = root.querySelector('[data-anim="pane-editor"]');
  var cursor     = root.querySelector('[data-anim="cursor"]');

  if (!inputText || !messages || !fileTree || !tabsEl || !chatPane || !editorPane || !cursor) return;

  var PROMPT = 'Draft a brand voice guide for Linterly';
  // Each chunk is one of: { text } or { bold } or { br }.
  // Rendering helper below converts these to safe DOM nodes (textContent
  // for text, <strong>textContent</strong> for bold, <br> for br).
  var ASSISTANT_CHUNKS = [
    [{ text: "Here's a brand voice draft:" }, { br: 1 }, { br: 1 }],
    [{ bold: 'Voice principles' }, { br: 1 }, { br: 1 }],
    [{ text: 'Linterly writes the way a senior PM ' }],
    [{ text: 'Slacks: short, specific, ' }],
    [{ text: 'contraction-heavy, never breathless.' }, { br: 1 }, { br: 1 }],
    [{ bold: 'Banned words:' }, { text: ' leverage, delve, ' }],
    [{ text: 'seamless, transform, empower.' }, { br: 1 }, { br: 1 }],
    [{ text: 'I’ll save this to ' }, { bold: 'Brand Voice.md' }, { text: ' ' }],
    [{ text: 'in your workspace.' }],
  ];

  // ── tiny DOM helpers ───────────────────────────────────────────────
  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        if (k === 'class') node.className = props[k];
        else if (k === 'dataset') Object.assign(node.dataset, props[k]);
        else if (k.indexOf('data-') === 0) node.setAttribute(k, props[k]);
        else if (k === 'text') node.textContent = props[k];
        else node.setAttribute(k, props[k]);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // SVG icons via DOMParser (trusted constants). Returns a fresh node each call.
  function svg(markup) {
    var doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    var n = doc.documentElement;
    return n && n.tagName.toLowerCase() === 'svg' ? document.importNode(n, true) : null;
  }
  var FILE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  function fileIcon() { return svg(FILE_ICON_SVG); }

  function setCursor(targetSelector, opts) {
    opts = opts || {};
    var rect = root.getBoundingClientRect();
    var target = root.querySelector(targetSelector);
    if (!target) return;
    var tRect = target.getBoundingClientRect();
    var x = tRect.left - rect.left + (opts.offsetX != null ? opts.offsetX : tRect.width / 2);
    var y = tRect.top - rect.top + (opts.offsetY != null ? opts.offsetY : tRect.height / 2);
    cursor.style.left = x + 'px';
    cursor.style.top  = y + 'px';
    cursor.classList.add('hero-anim__cursor--visible');
  }

  function pulseClick() {
    cursor.classList.remove('hero-anim__cursor--clicking');
    void cursor.offsetWidth; // restart the animation
    cursor.classList.add('hero-anim__cursor--clicking');
  }

  function setActivePane(which) {
    if (which === 'chat') {
      chatPane.classList.add('hero-anim__pane--active');
      editorPane.classList.remove('hero-anim__pane--active');
    } else {
      editorPane.classList.add('hero-anim__pane--active');
      chatPane.classList.remove('hero-anim__pane--active');
    }
  }

  // ── builders ───────────────────────────────────────────────────────
  function makeTab(name, active, animate) {
    var icon = fileIcon();
    var label = el('span', { text: name });
    var classes = 'hero-anim__tab';
    if (active) classes += ' hero-anim__tab--active';
    if (animate) classes += ' hero-anim__tab--enter';
    var t = el('div', { 'class': classes, 'data-tab': name }, [icon, label]);
    return t;
  }

  function makeFile(name) {
    var li = el('div', {
      'class': 'hero-anim__file hero-anim__file--new',
      'data-file': name,
    }, [fileIcon(), el('span', { text: name })]);
    return li;
  }

  function activateOnlyTab(name) {
    Array.prototype.forEach.call(tabsEl.children, function (t) {
      if (t.getAttribute('data-tab') === name) {
        t.classList.add('hero-anim__tab--active');
      } else {
        t.classList.remove('hero-anim__tab--active');
      }
    });
  }

  function reset() {
    inputText.textContent = '';
    if (inputCaret) inputCaret.style.display = 'none';
    clear(messages);
    setActivePane('chat');
    cursor.classList.remove('hero-anim__cursor--visible');
    cursor.classList.remove('hero-anim__cursor--clicking');
    cursor.style.left = '40%';
    cursor.style.top  = '60%';

    var brandVoiceLi = fileTree.querySelector('[data-file="Brand Voice.md"]');
    if (brandVoiceLi) brandVoiceLi.remove();
    fileTree.querySelectorAll('.hero-anim__file').forEach(function (e) {
      e.classList.remove('hero-anim__file--active');
    });
    var launchPlan = fileTree.querySelector('[data-file="Launch Plan.md"]');
    if (launchPlan) launchPlan.classList.add('hero-anim__file--active');

    clear(tabsEl);
    tabsEl.appendChild(makeTab('Launch Plan', true, false));
  }

  function addUserMessage(text) {
    messages.appendChild(el('div', { 'class': 'hero-anim__msg hero-anim__msg--user', text: text }));
  }

  function showThinking() {
    messages.appendChild(el('div', { 'class': 'hero-anim__thinking', 'data-anim-thinking': '1' }, [
      el('span'), el('span'), el('span'),
    ]));
  }

  function removeThinking() {
    var t = messages.querySelector('[data-anim-thinking]');
    if (t) t.remove();
  }

  // Streaming assistant message: appends typed nodes one chunk at a time.
  // Each chunk is an array of { text } / { bold } / { br } parts.
  function startAssistantStream() {
    var m = el('div', { 'class': 'hero-anim__msg hero-anim__msg--assistant', 'data-anim-stream': '1' });
    messages.appendChild(m);
  }

  function appendAssistantChunk(parts, isLast) {
    var m = messages.querySelector('[data-anim-stream]');
    if (!m) return;
    // Remove the existing trailing caret (if any) before appending more.
    var caret = m.querySelector('.hero-anim__caret');
    if (caret) caret.remove();
    parts.forEach(function (p) {
      if (p.text != null) {
        m.appendChild(document.createTextNode(p.text));
      } else if (p.bold != null) {
        m.appendChild(el('strong', { text: p.bold }));
      } else if (p.br != null) {
        m.appendChild(document.createElement('br'));
      }
    });
    if (!isLast) {
      m.appendChild(el('span', { 'class': 'hero-anim__caret' }));
    }
    messages.scrollTop = messages.scrollHeight;
  }

  function finishAssistantStream() {
    var m = messages.querySelector('[data-anim-stream]');
    if (m) {
      var caret = m.querySelector('.hero-anim__caret');
      if (caret) caret.remove();
      m.removeAttribute('data-anim-stream');
    }
  }

  function appearBrandVoiceFile() {
    if (fileTree.querySelector('[data-file="Brand Voice.md"]')) return;
    fileTree.appendChild(makeFile('Brand Voice.md'));
  }

  function openBrandVoice() {
    fileTree.querySelectorAll('.hero-anim__file').forEach(function (e) {
      e.classList.remove('hero-anim__file--active');
    });
    var bv = fileTree.querySelector('[data-file="Brand Voice.md"]');
    if (bv) bv.classList.add('hero-anim__file--active');
    if (!tabsEl.querySelector('[data-tab="Brand Voice"]')) {
      tabsEl.appendChild(makeTab('Brand Voice', false, true));
    }
    activateOnlyTab('Brand Voice');
    setActivePane('editor');
  }

  // ── timing schedule ────────────────────────────────────────────────
  function buildSchedule() {
    var s = [];
    s.push([0.0, reset]);
    s.push([1.4, function () { setCursor('[data-anim="input"]', { offsetX: 30, offsetY: 14 }); }]);
    s.push([1.9, function () { if (inputCaret) inputCaret.style.display = ''; }]);

    var typeStart = 2.1;
    var perChar = 0.075;
    for (var i = 1; i <= PROMPT.length; i++) {
      (function (n) {
        s.push([typeStart + (n - 1) * perChar, function () {
          inputText.textContent = PROMPT.slice(0, n);
        }]);
      })(i);
    }

    var sendT = typeStart + PROMPT.length * perChar + 0.3;
    s.push([sendT, function () { setCursor('[data-anim="send-btn"]'); }]);
    s.push([sendT + 0.4, function () {
      pulseClick();
      addUserMessage(PROMPT);
      inputText.textContent = '';
      if (inputCaret) inputCaret.style.display = 'none';
      showThinking();
    }]);

    var streamStart = sendT + 1.1;
    s.push([streamStart, function () {
      removeThinking();
      startAssistantStream();
    }]);
    var t = streamStart + 0.05;
    var perChunk = 0.45;
    for (var c = 0; c < ASSISTANT_CHUNKS.length; c++) {
      (function (idx) {
        s.push([t, function () {
          appendAssistantChunk(ASSISTANT_CHUNKS[idx], idx === ASSISTANT_CHUNKS.length - 1);
        }]);
      })(c);
      t += perChunk;
    }
    s.push([t + 0.1, finishAssistantStream]);

    var fileAppearT = streamStart + 1.6;
    s.push([fileAppearT, appearBrandVoiceFile]);

    var openT = t + 0.7;
    s.push([openT, function () { setCursor('[data-file="Brand Voice.md"]'); }]);
    s.push([openT + 0.5, function () { pulseClick(); openBrandVoice(); }]);

    return { schedule: s, total: openT + 5.0 };
  }

  var built = buildSchedule();
  var schedule = built.schedule;
  var TOTAL = built.total;

  // ── RAF loop ───────────────────────────────────────────────────────
  var startedAt = null;
  var firedThisCycle = new Set();
  function tick(ts) {
    if (startedAt == null) startedAt = ts;
    var elapsed = (ts - startedAt) / 1000;
    if (elapsed >= TOTAL) {
      startedAt = ts;
      firedThisCycle = new Set();
      elapsed = 0;
    }
    for (var i = 0; i < schedule.length; i++) {
      if (firedThisCycle.has(i)) continue;
      if (elapsed >= schedule[i][0]) {
        try { schedule[i][1](); } catch (e) { /* keep the loop alive */ }
        firedThisCycle.add(i);
      }
    }
    requestAnimationFrame(tick);
  }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          requestAnimationFrame(tick);
          io.disconnect();
        }
      });
    }, { threshold: 0.15 });
    io.observe(root);
  } else {
    requestAnimationFrame(tick);
  }
})();
