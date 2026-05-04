const STORAGE_KEY = "pomodoro:state";
const WORK_MINUTES = 25;
const BREAK_MINUTES = 5;
const TICK_MS = 1e3;
function defaultState() {
  return {
    phase: "work",
    remainingMs: WORK_MINUTES * 60 * 1e3,
    running: false,
    cyclesCompleted: 0,
    lastResumedAt: null
  };
}
function durationFor(phase) {
  return (phase === "work" ? WORK_MINUTES : BREAK_MINUTES) * 60 * 1e3;
}
function formatRemaining(ms) {
  const total = Math.max(0, Math.floor(ms / 1e3));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function tickState(state, now) {
  if (!state.running || state.lastResumedAt === null) return state;
  const elapsed = now - state.lastResumedAt;
  const remaining = state.remainingMs - elapsed;
  if (remaining > 0) {
    return { ...state, remainingMs: remaining, lastResumedAt: now };
  }
  const nextPhase = state.phase === "work" ? "break" : "work";
  return {
    phase: nextPhase,
    remainingMs: durationFor(nextPhase),
    running: false,
    cyclesCompleted: state.cyclesCompleted + (state.phase === "work" ? 1 : 0),
    lastResumedAt: null
  };
}
function isValidState(value) {
  if (!value || typeof value !== "object") return false;
  const v = value;
  return (v.phase === "work" || v.phase === "break") && typeof v.remainingMs === "number" && typeof v.running === "boolean" && typeof v.cyclesCompleted === "number" && (v.lastResumedAt === null || typeof v.lastResumedAt === "number");
}
function renderPanelHtml(state) {
  const accent = state.phase === "work" ? "#dc2626" : "#16a34a";
  const phaseLabel = state.phase === "work" ? "Focus" : "Break";
  const status = state.running ? "Running" : state.remainingMs === durationFor(state.phase) ? "Ready" : "Paused";
  return [
    '<div style="font-family: system-ui, -apple-system, sans-serif; padding: 20px; color: #1f2937; text-align: center;">',
    `<div style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: ${accent};">${phaseLabel}</div>`,
    `<div style="font-size: 56px; font-weight: 700; line-height: 1; margin: 12px 0; font-variant-numeric: tabular-nums; color: ${accent};">${formatRemaining(state.remainingMs)}</div>`,
    `<div style="font-size: 12px; color: #6b7280; margin-bottom: 16px;">${status} &middot; ${state.cyclesCompleted} cycle${state.cyclesCompleted === 1 ? "" : "s"} completed</div>`,
    '<div style="font-size: 11px; color: #9ca3af; line-height: 1.6;">',
    "Use the toolbar buttons or the command palette:<br>",
    "<code>pomodoro.start</code><br>",
    "<code>pomodoro.pause</code><br>",
    "<code>pomodoro.reset</code>",
    "</div>",
    "</div>"
  ].join("");
}
const plugin = {
  async activate(api) {
    let state = defaultState();
    try {
      const stored = await api.storage.get(STORAGE_KEY);
      if (isValidState(stored)) {
        state = { ...stored, running: false, lastResumedAt: null };
      }
    } catch {
    }
    const persist = async () => {
      try {
        await api.storage.set(STORAGE_KEY, state);
      } catch {
      }
    };
    const renderPanel = () => {
      api.sidebar.addPanel({
        id: "pomodoro-panel",
        title: "Pomodoro",
        html: renderPanelHtml(state)
      });
    };
    renderPanel();
    api.commands.register("pomodoro.start", async () => {
      if (state.running) return state;
      state = { ...state, running: true, lastResumedAt: Date.now() };
      await persist();
      renderPanel();
      api.notify.info(`Pomodoro: ${state.phase === "work" ? "focus" : "break"} timer started.`);
      return state;
    });
    api.commands.register("pomodoro.pause", async () => {
      if (!state.running) return state;
      const now = Date.now();
      const ticked = tickState(state, now);
      state = { ...ticked, running: false, lastResumedAt: null };
      await persist();
      renderPanel();
      api.notify.info("Pomodoro: paused.");
      return state;
    });
    api.commands.register("pomodoro.reset", async () => {
      state = { ...defaultState(), cyclesCompleted: state.cyclesCompleted };
      await persist();
      renderPanel();
      api.notify.info("Pomodoro: reset to 25:00.");
      return state;
    });
    api.toolbar.addButton({
      id: "pomodoro-start-button",
      icon: "play",
      tooltip: "Start pomodoro timer",
      command: "pomodoro.start"
    });
    api.toolbar.addButton({
      id: "pomodoro-pause-button",
      icon: "pause",
      tooltip: "Pause pomodoro timer",
      command: "pomodoro.pause"
    });
    api.toolbar.addButton({
      id: "pomodoro-reset-button",
      icon: "rotate-ccw",
      tooltip: "Reset pomodoro timer",
      command: "pomodoro.reset"
    });
    setInterval(() => {
      if (!state.running) return;
      const now = Date.now();
      const previousPhase = state.phase;
      const next = tickState(state, now);
      if (next.phase !== previousPhase) {
        state = next;
        void persist();
        renderPanel();
        if (next.phase === "break") {
          api.notify.info("Pomodoro: focus session complete. Take a 5-minute break.");
        } else {
          api.notify.info("Pomodoro: break over. Ready for the next focus session.");
        }
        return;
      }
      state = next;
      renderPanel();
    }, TICK_MS);
  }
};
export {
  plugin as default
};
