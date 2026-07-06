/**
 * UI Iteration System — pure handle-integrity decision logic (unit-tested).
 *
 * The round-2 review's P0: "attached to real control" was too loose — a handle
 * that merely CONTAINS a button passed, so a handle drifting onto a wrapper card
 * (with the real, possibly-disabled button inside) went undetected. Rule now:
 *
 *   For control/input handles the handle element must BE the interactive
 *   element. A wrapper is allowed ONLY via an explicit entry in ALLOWED_WRAPPERS
 *   that names the inner target selector (and thus the real click point); then
 *   the INNER target's visibility/enabled/existence is what's checked.
 *
 * `facts` is collected in the live DOM by the robot (rehearsal.mjs). This module
 * is pure so the decision can be tested without a browser.
 *
 * facts = {
 *   count,               // elements matching [data-testid="id"]
 *   visible,             // handle element visible
 *   pointerNone,         // computed pointer-events:none on the handle element
 *   selfControl,         // handle element ITSELF is a control (button/a/input/role)
 *   selfInput,           // handle element ITSELF is a text input
 *   disabled,            // handle element itself disabled/aria-disabled
 *   // only when an ALLOWED_WRAPPERS entry exists for this id:
 *   targetExists, targetVisible, targetEnabled, targetControl, targetInput,
 * }
 */

// Explicit allow-list for handles that legitimately sit on a WRAPPER, mapping to
// the inner interactive target. Empty by default — the rule is "the handle IS
// the control" unless a wrapper is deliberately registered here. Adding an entry
// is a conscious decision (like a handle migration), not an accident.
//
// Shape (round-3 review): an entry MUST store the target selector AND a click
// point, and the resolved target must be proven a real control/input at runtime
// — a bare `{}` (or a target pointing at a plain div) is rejected, so
// whitelisting can never wave a non-control through.
//   { '<testid>': { target: '<css selector within the wrapper>', clickPoint: 'center' } }
// clickPoint is 'center' (default) or { x, y } offsets within the target.
export const ALLOWED_WRAPPERS = {};

/**
 * @param {object} facts
 * @param {'control'|'input'|'region'} kind
 * @param {object} [allowed] ALLOWED_WRAPPERS (injectable for tests)
 * @returns {{ ok: boolean, issues: string[] }}
 */
export function evaluateHandleFacts(facts, kind, allowed = ALLOWED_WRAPPERS) {
  const issues = [];
  if (!facts || facts.count === 0) return { ok: false, issues: ['not present on this screen'] };
  if (facts.count > 1) issues.push(`duplicate handle (${facts.count} matches — robot may grip the wrong one)`);
  if (!facts.visible) issues.push('not visible');
  if (facts.pointerNone) issues.push('pointer-events:none (unclickable)');

  if (kind === 'control' || kind === 'input') {
    const entry = allowed && Object.prototype.hasOwnProperty.call(allowed, facts.id) ? allowed[facts.id] : null;
    if (entry) {
      // Deliberate wrapper: the INNER target is the real control/click point.
      // The entry itself must be well-formed (target selector + click point).
      if (!entry.target || typeof entry.target !== 'string') {
        issues.push('ALLOWED_WRAPPERS entry missing a target selector');
      } else if (!entry.clickPoint) {
        issues.push('ALLOWED_WRAPPERS entry missing a clickPoint');
      } else if (!facts.targetExists) {
        issues.push('allowed-wrapper target selector matches nothing');
      } else {
        if (!facts.targetVisible) issues.push('allowed-wrapper target not visible');
        // The resolved target must be PROVEN a real control/input — a visible
        // <div> must not pass just because it was whitelisted.
        const targetIsReal = kind === 'input' ? facts.targetInput : facts.targetControl;
        if (!targetIsReal) issues.push(`allowed-wrapper target is not a real ${kind}`);
        // Disabled applies to inputs exactly like controls.
        if (facts.targetEnabled === false) issues.push(`allowed-wrapper target ${kind} is disabled`);
      }
    } else {
      // Default rule: the handle element must BE the interactive element.
      const selfOk = kind === 'input' ? facts.selfInput : facts.selfControl;
      if (!selfOk) {
        issues.push(
          `handle is on a wrapper, not the real ${kind} (register it in ALLOWED_WRAPPERS with a target selector + clickPoint if intentional)`,
        );
      } else if (facts.disabled) {
        // A disabled INPUT is as unusable as a disabled control (round-3 P0).
        issues.push(`${kind} is disabled`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}
