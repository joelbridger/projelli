codex
Findings first.

**P0 — classifier still misses real behavior changes in UI files**
`scripts/ui-system/classify-tier.mjs:61-71`

It scans changed code, but the behavior pattern only catches inline handler logic. This diff would be classified as Tier S, not Tier B:

```diff
- <button onClick={connect}>
+ <button onClick={disconnect}>
```

Same problem for changes like `disabled={canSend}` → `disabled={false}`, `href`, `type="submit"`, `aria-disabled`, etc. Those change what the app does, but do not match the current behavior regex.

Recommended fix: treat any changed event binding, disabled state, href/form action, form type, or ARIA-disabled binding in `src/ui`, `src/app`, or `src/features` as Tier B unless proven static markup only.

**P0 — handle guard does not globally enforce uniqueness / visibility / enabled / real-control attachment**
`scripts/ui-system/handle-guard.mjs:69-91`  
`scripts/ui-system/rehearsal.mjs:158-192`  
`scripts/ui-system/rehearsal.mjs:283-289`  
`scripts/ui-system/rehearsal.mjs:384-394`

The static guard only checks that each handle string still exists. It does not fail on duplicate handles, hidden handles, disabled handles, or handles moved onto wrappers.

The runtime robot check does those deeper checks, but only for a tiny reachable set: a few Client Map handles and Ask composer handles. It does not check the whole handle inventory, including the connector handles added in this branch.

So P0 requirement 3 is only partially implemented.

**P0 — “attached to real control” is too loose**
`scripts/ui-system/rehearsal.mjs:174-179`

The check passes if the handle merely contains a button/input somewhere inside it:

```js
el.matches(controlSel) || !!el.querySelector(controlSel)
```

That still allows the bad case from the review: `data-testid` moves from the real button to a wrapper card. The robot may click the wrapper’s center and miss the real control.

Recommended fix: for control/input handles, require the element itself to be the interactive element, or store an explicit allowed-wrapper rule with a target selector and click point.

**P1 — Tier S gate says component tests are required, but does not run them**
`scripts/ui-system/gate-tier.mjs:66-68`

For Tier S, the spec says component tests plus robot rehearsal. The script only prints a reminder:

```js
console.log('(Tier S: run your SCOPED component tests...)')
```

Then it can pass without any scoped component tests actually running.

Recommended fix: require a test command argument for Tier S, or auto-select tests from changed files and fail when none run.

**P0 Requirement Check**

Requirement 1, behavior-adjacent CSS escalates out of paint-only: mostly implemented. `RISKY_CSS` plus the strict safe-line fallback makes CSS conservative.

Requirement 2, classifier scans changed code not just paths: partially implemented, but still misclassifies simple handler-binding and disabled-state changes.

Requirement 3, handle guards check uniqueness/visibility/enabled/real-control: not genuinely implemented globally. Only a small robot path checks it, and even that accepts wrapper handles.

Read-only checks run: classifier, `handle-guard`, and `token-guard`. I did not run `rehearsal.mjs` because it writes `.rehearsal` artifacts, and you asked for no file changes.

VERDICT: BLOCKING
tokens used
179,037
Findings first.

**P0 — classifier still misses real behavior changes in UI files**
`scripts/ui-system/classify-tier.mjs:61-71`

It scans changed code, but the behavior pattern only catches inline handler logic. This diff would be classified as Tier S, not Tier B:

```diff
- <button onClick={connect}>
+ <button onClick={disconnect}>
```

Same problem for changes like `disabled={canSend}` → `disabled={false}`, `href`, `type="submit"`, `aria-disabled`, etc. Those change what the app does, but do not match the current behavior regex.

Recommended fix: treat any changed event binding, disabled state, href/form action, form type, or ARIA-disabled binding in `src/ui`, `src/app`, or `src/features` as Tier B unless proven static markup only.

**P0 — handle guard does not globally enforce uniqueness / visibility / enabled / real-control attachment**
`scripts/ui-system/handle-guard.mjs:69-91`  
`scripts/ui-system/rehearsal.mjs:158-192`  
`scripts/ui-system/rehearsal.mjs:283-289`  
`scripts/ui-system/rehearsal.mjs:384-394`

The static guard only checks that each handle string still exists. It does not fail on duplicate handles, hidden handles, disabled handles, or handles moved onto wrappers.

The runtime robot check does those deeper checks, but only for a tiny reachable set: a few Client Map handles and Ask composer handles. It does not check the whole handle inventory, including the connector handles added in this branch.

So P0 requirement 3 is only partially implemented.

**P0 — “attached to real control” is too loose**
`scripts/ui-system/rehearsal.mjs:174-179`

The check passes if the handle merely contains a button/input somewhere inside it:

```js
el.matches(controlSel) || !!el.querySelector(controlSel)
```

That still allows the bad case from the review: `data-testid` moves from the real button to a wrapper card. The robot may click the wrapper’s center and miss the real control.

Recommended fix: for control/input handles, require the element itself to be the interactive element, or store an explicit allowed-wrapper rule with a target selector and click point.

**P1 — Tier S gate says component tests are required, but does not run them**
`scripts/ui-system/gate-tier.mjs:66-68`

For Tier S, the spec says component tests plus robot rehearsal. The script only prints a reminder:

```js
console.log('(Tier S: run your SCOPED component tests...)')
```

Then it can pass without any scoped component tests actually running.

Recommended fix: require a test command argument for Tier S, or auto-select tests from changed files and fail when none run.

**P0 Requirement Check**

Requirement 1, behavior-adjacent CSS escalates out of paint-only: mostly implemented. `RISKY_CSS` plus the strict safe-line fallback makes CSS conservative.

Requirement 2, classifier scans changed code not just paths: partially implemented, but still misclassifies simple handler-binding and disabled-state changes.

Requirement 3, handle guards check uniqueness/visibility/enabled/real-control: not genuinely implemented globally. Only a small robot path checks it, and even that accepts wrapper handles.

Read-only checks run: classifier, `handle-guard`, and `token-guard`. I did not run `rehearsal.mjs` because it writes `.rehearsal` artifacts, and you asked for no file changes.

VERDICT: BLOCKING
