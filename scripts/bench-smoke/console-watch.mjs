// scripts/bench-smoke/console-watch.mjs — console-error cleanliness, built
// Note: "eval" below refers to desktop-drive.mjs's `eval` CLI subcommand,
// which runs Playwright's page.evaluate(js) inside the bench's own browser
// process — not a call to the JS eval() builtin in this file (there is none
// here; this module only builds and interprets strings).
//
// entirely on top of desktop-drive.mjs's existing `eval` command (no new CDP
// connection, nothing added to desktop-drive.mjs itself). `installScript()`
// is eval'd once per check-suite run to patch console.error/window.onerror/
// unhandledrejection into a page-global buffer; `readAndClearScript()` is
// eval'd after each check to pull (and clear) whatever landed since the last
// read, so one page-wide console-error slip doesn't get blamed on every
// subsequent check.

export function installScript() {
  return (
    "if(!window.__benchSmokeErrors){" +
    "window.__benchSmokeErrors=[];" +
    "const origErr=console.error.bind(console);" +
    "console.error=(...a)=>{" +
    "window.__benchSmokeErrors.push(a.map(x=>{try{return typeof x==='string'?x:JSON.stringify(x)}catch{return String(x)}}).join(' '));" +
    "origErr(...a);};" +
    "window.addEventListener('error',e=>window.__benchSmokeErrors.push('window.onerror: '+(e && e.message || String(e))));" +
    "window.addEventListener('unhandledrejection',e=>window.__benchSmokeErrors.push('unhandledrejection: '+String(e && e.reason)));" +
    "}" +
    "'installed'"
  );
}

export function readAndClearScript() {
  return "(()=>{const e=window.__benchSmokeErrors||[];window.__benchSmokeErrors=[];return e;})()";
}

/** Parsed eval() result -> {clean, errors[]}. Tolerates a non-array result
 * (e.g. install script hadn't run yet) by treating it as "no data" rather
 * than silently claiming clean. */
export function interpretConsoleErrors(evalResult) {
  if (!Array.isArray(evalResult)) {
    return { clean: null, errors: [], note: 'console watch was not installed on this page (no array returned)' };
  }
  return { clean: evalResult.length === 0, errors: evalResult, note: null };
}
