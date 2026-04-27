/* Hero animation — vanilla JS state machine driving a faithful Projelli
 * replica. RAF tick + precomputed timing schedule.
 *
 * All DOM is built via createElement / textContent (no innerHTML), so
 * there's no XSS surface even though every input is a trusted constant.
 *
 * Story (~22s, then loops):
 *   t=0    — workspace settled, Launch Plan tab active
 *   t=1.4  — cursor moves to chat input
 *   t=2.1  — types prompt char-by-char
 *   t=6.5  — cursor moves to coral send button + clicks
 *   t=7.0  — user message bubble appears (with You · time meta)
 *           thinking dots + Stop button appear
 *   t=8.0  — AI assistant streams response in chunks
 *   t=12.5 — Brand Voice.md pops into the file tree
 *   t=15.0 — cursor moves to Brand Voice.md
 *   t=15.5 — clicks; new tab "Drafting brand voic..." opens; editor view
 *   t=20.0 — hold final state
 *   t=22.0 — reset and loop
 */
(function () {
  var root = document.getElementById('hero-anim');
  if (!root) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  var inputText  = root.querySelector('[data-anim="input-text"]');
  var inputCaret = root.querySelector('[data-anim="input-caret"]');
  var messages   = root.querySelector('[data-anim="messages"]');
  var fileTree   = root.querySelector('[data-anim="file-tree"]');
  var tabsEl     = root.querySelector('[data-anim="tabs"]');
  var chatPane   = root.querySelector('[data-anim="pane-chat"]');
  var editorPane = root.querySelector('[data-anim="pane-editor"]');
  var cursor     = root.querySelector('[data-anim="cursor"]');
  var statusFile  = root.querySelector('[data-anim="status-file"]');
  var statusFile2 = root.querySelector('[data-anim="status-file2"]');
  var statusFiles = root.querySelector('[data-anim="status-files-open"]');

  if (!inputText || !messages || !fileTree || !tabsEl || !chatPane || !editorPane || !cursor) return;

  var PROMPT = 'Write a brand voice guide for Linterly and save it to Brand Voice.md';

  // Each block is one paragraph in the assistant card, rendered as its
  // own <div>. parts may be { text } or { bold }.
  var ASSISTANT_BLOCKS = [
    { parts: [{ text: "Here's a brand-voice draft for Linterly:" }] },
    { parts: [{ bold: 'Voice principles' }] },
    { parts: [{ text: 'Linterly writes the way a senior PM Slacks: short, specific, contraction-heavy, never breathless.' }] },
    { parts: [{ bold: 'Banned words:' }, { text: ' leverage, delve, seamless, transform, empower' }] },
  ];

  var NEW_TAB_LABEL = 'Drafting brand voic…';

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
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

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
    void cursor.offsetWidth;
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
    var pencil = el('span', { 'class': 'hero-anim__pencil', 'aria-hidden': 'true', text: '✎' });
    var classes = 'hero-anim__tab';
    if (active) classes += ' hero-anim__tab--active';
    if (animate) classes += ' hero-anim__tab--enter';
    return el('div', { 'class': classes, 'data-tab': name }, [icon, label, pencil]);
  }

  function makeFile(name) {
    return el('div', {
      'class': 'hero-anim__file hero-anim__file--new',
      'data-file': name,
    }, [fileIcon(), el('span', { text: name })]);
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

  function setStatusFile(name, count) {
    if (statusFile)  statusFile.textContent  = name;
    if (statusFile2) statusFile2.textContent = name;
    if (statusFiles) statusFiles.textContent = count + (count === 1 ? ' file open' : ' files open');
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
    setStatusFile('Drafting brand voice for Linterly', 1);
  }

  function timeNow() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + (m < 10 ? '0' + m : m) + ' ' + ampm;
  }

  function addUserMessage(text) {
    var t = timeNow();
    messages.appendChild(el('div', { 'class': 'hero-anim__msg-meta hero-anim__msg-meta--right' }, [
      el('span', { text: 'You' }),
      el('span', { text: t }),
    ]));
    messages.appendChild(el('div', { 'class': 'hero-anim__msg hero-anim__msg--user', text: text }));
  }

  function showThinking() {
    var dots = el('div', { 'class': 'hero-anim__thinking' }, [el('span'), el('span'), el('span')]);
    var stop = el('span', { 'class': 'hero-anim__stop-btn', text: 'Stop' });
    messages.appendChild(el('div', { 'class': 'hero-anim__thinking-row', 'data-anim-thinking': '1' }, [dots, stop]));
  }
  function removeThinking() {
    var t = messages.querySelector('[data-anim-thinking]');
    if (t) t.remove();
  }

  function startAssistantStream() {
    messages.appendChild(el('div', { 'class': 'hero-anim__msg-meta' }, [
      el('span', { text: 'Assistant' }),
      el('span', { text: timeNow() }),
    ]));
    var m = el('div', { 'class': 'hero-anim__msg hero-anim__msg--assistant', 'data-anim-stream': '1' });
    messages.appendChild(m);
  }

  function appendAssistantBlock(block, isLast) {
    var m = messages.querySelector('[data-anim-stream]');
    if (!m) return;
    var trailingCaret = m.querySelector('.hero-anim__caret');
    if (trailingCaret) trailingCaret.remove();

    var line = el('div');
    block.parts.forEach(function (p) {
      if (p.text != null) line.appendChild(document.createTextNode(p.text));
      else if (p.bold != null) line.appendChild(el('strong', { text: p.bold }));
    });
    m.appendChild(line);
    if (!isLast) m.appendChild(el('span', { 'class': 'hero-anim__caret' }));
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
    if (!tabsEl.querySelector('[data-tab="Brand Voice.md"]')) {
      tabsEl.appendChild(makeTab(NEW_TAB_LABEL, false, true));
      // Use the visible label text as the data-tab key for the active toggle
      tabsEl.lastChild.setAttribute('data-tab', 'Brand Voice.md');
    }
    activateOnlyTab('Brand Voice.md');
    setActivePane('editor');
    setStatusFile('Brand Voice.md', 2);
  }

  // ── timing schedule ────────────────────────────────────────────────
  function buildSchedule() {
    var s = [];
    s.push([0.0, reset]);
    s.push([1.4, function () { setCursor('[data-anim="input"]', { offsetX: 30, offsetY: 14 }); }]);
    s.push([1.9, function () { if (inputCaret) inputCaret.style.display = ''; }]);

    var typeStart = 2.1;
    var perChar = 0.055;
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

    var streamStart = sendT + 1.2;
    s.push([streamStart, function () {
      removeThinking();
      startAssistantStream();
    }]);

    var t = streamStart + 0.05;
    var perBlock = 0.7;
    for (var c = 0; c < ASSISTANT_BLOCKS.length; c++) {
      (function (idx) {
        s.push([t, function () {
          appendAssistantBlock(ASSISTANT_BLOCKS[idx], idx === ASSISTANT_BLOCKS.length - 1);
        }]);
      })(c);
      t += perBlock;
    }
    s.push([t + 0.1, finishAssistantStream]);

    var fileAppearT = t + 0.4;
    s.push([fileAppearT, appearBrandVoiceFile]);

    var openT = fileAppearT + 1.6;
    s.push([openT, function () { setCursor('[data-file="Brand Voice.md"]'); }]);
    s.push([openT + 0.55, function () { pulseClick(); openBrandVoice(); }]);

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
