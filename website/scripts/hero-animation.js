/* Hero animation for Keepance new design — RAF state machine.
 *
 * Story (~15s loop):
 *   t=0    — reset all animated elements to hidden
 *   t=1.2  — cursor appears near the chat input
 *   t=1.7  — text caret blinks in input
 *   t=2.1  — types the prompt char-by-char
 *   t=5.6  — cursor moves to send button
 *   t=6.3  — clicks; user message appears, thinking dots appear
 *   t=7.8  — thinking ends; AI response streams in
 *   t=10.5 — saved confirmation fades in
 *   t=11.1 — Deposition Notes.md fades in on the sidebar
 *   t=14.9 — loop resets
 */
(function () {
  var root = document.getElementById('hero-anim');
  if (!root) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function q(name) { return root.querySelector('[data-anim="' + name + '"]'); }

  var newFile   = q('new-file');
  var msgUser   = q('msg-user');
  var userText  = q('user-text');
  var msgAi     = q('msg-ai');
  var aiText    = q('ai-text');
  var thinking  = q('thinking');
  var saved     = q('saved');
  var inputEl   = q('input');
  var inputText = q('input-text');
  var caret     = q('caret');
  var sendBtn   = q('send');
  var cursor    = q('cursor');

  if (!inputText || !cursor || !msgUser || !msgAi) return;

  var PROMPT = 'Find contradictions in Halvorsen’s deposition vs. her March 14 statement.';

  var AI_RESPONSE = [
    'Found 3 contradictions.',
    '',
    '→ p.47: “Not present at March 14.”',
    '→ Exhibit C: signed attendance record, her signature.',
    '',
    'Saved → Deposition Notes.md'
  ].join('\n');

  function show(el) { if (el) el.style.opacity = '1'; }
  function hide(el) { if (el) el.style.opacity = '0'; }

  function moveCursor(target, offX, offY) {
    if (!target) return;
    var rr = root.getBoundingClientRect();
    var tr = target.getBoundingClientRect();
    cursor.style.left = (tr.left - rr.left + (offX != null ? offX : tr.width / 2)) + 'px';
    cursor.style.top  = (tr.top  - rr.top  + (offY != null ? offY : tr.height / 2)) + 'px';
  }

  function click() {
    cursor.classList.remove('clicking');
    void cursor.offsetWidth;
    cursor.classList.add('clicking');
  }

  function reset() {
    hide(newFile); hide(msgUser); hide(msgAi); hide(thinking); hide(saved);
    cursor.classList.remove('visible', 'clicking');
    cursor.style.transition = 'none';
    cursor.style.left = '50%';
    cursor.style.top  = '60%';
    if (inputText) inputText.textContent = '';
    if (userText)  userText.textContent  = '';
    if (aiText)    aiText.textContent    = '';
    if (caret)     caret.style.display   = 'none';
    requestAnimationFrame(function () { cursor.style.transition = ''; });
  }

  function buildSchedule() {
    var s = [];

    s.push([0.0, reset]);

    s.push([1.2, function () {
      cursor.classList.add('visible');
      moveCursor(inputEl, 18, 16);
    }]);

    s.push([1.7, function () { if (caret) caret.style.display = ''; }]);

    var typeStart = 2.1, perChar = 0.048;
    for (var i = 1; i <= PROMPT.length; i++) {
      (function (n) {
        s.push([typeStart + (n - 1) * perChar, function () {
          if (inputText) inputText.textContent = PROMPT.slice(0, n);
        }]);
      })(i);
    }
    var doneTyping = typeStart + PROMPT.length * perChar;

    s.push([doneTyping + 0.2, function () { moveCursor(sendBtn); }]);

    var sendT = doneTyping + 0.65;
    s.push([sendT, function () {
      click();
      if (inputText) inputText.textContent = '';
      if (caret)     caret.style.display   = 'none';
      if (userText)  userText.textContent  = PROMPT;
      show(msgUser);
      show(thinking);
    }]);

    s.push([sendT + 0.35, function () { cursor.classList.remove('visible'); }]);

    var streamStart = sendT + 1.5;
    s.push([streamStart, function () { hide(thinking); show(msgAi); }]);

    var perAiChar = 0.02;
    for (var j = 1; j <= AI_RESPONSE.length; j++) {
      (function (n) {
        s.push([streamStart + 0.05 + (n - 1) * perAiChar, function () {
          if (aiText) aiText.textContent = AI_RESPONSE.slice(0, n);
        }]);
      })(j);
    }
    var doneStream = streamStart + 0.05 + AI_RESPONSE.length * perAiChar;

    s.push([doneStream + 0.3,  function () { show(saved); }]);
    s.push([doneStream + 0.85, function () { show(newFile); }]);

    return { schedule: s, total: doneStream + 4.5 };
  }

  var built    = buildSchedule();
  var schedule = built.schedule;
  var TOTAL    = built.total;

  var startedAt = null;
  var fired     = [];

  function tick(ts) {
    if (startedAt === null) { startedAt = ts; fired = []; }
    var elapsed = (ts - startedAt) / 1000;
    if (elapsed >= TOTAL) { startedAt = ts; fired = []; elapsed = 0; }
    for (var i = 0; i < schedule.length; i++) {
      if (fired[i]) continue;
      if (elapsed >= schedule[i][0]) {
        try { schedule[i][1](); } catch (e) { /* keep loop alive */ }
        fired[i] = true;
      }
    }
    requestAnimationFrame(tick);
  }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { requestAnimationFrame(tick); io.disconnect(); }
      });
    }, { threshold: 0.15 });
    io.observe(root);
  } else {
    requestAnimationFrame(tick);
  }
})();
