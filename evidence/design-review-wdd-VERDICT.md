# Workflow dependent due — design review

## Result

**Changes requested: 3.** The feature works in the real workflow screen and stays completely absent when its flag is off. The overall light surface, card treatment, and plain-language refusal are consistent with the existing workflow screen. It is not ready to merge as a polished advisor-facing extension yet.

## Evidence

- [Flag on — step timing editor](design-review-wdd/01-flag-on-step-editor.png)
- [Derived date after predecessor completion](design-review-wdd/02-derived-due-after-predecessor.png)
- [Real out-of-order completion refusal](design-review-wdd/03-out-of-order-refusal.png)
- [Flag off — no extension trace](design-review-wdd/04-flag-off-no-extension.png)

## What was driven

I used a new local display on port 5188 (not 5174), launched Chromium with `--password-store=basic`, and used a new disposable browser profile. The browser was closed after capture. The exact UI completion button was used for both the successful predecessor completion and the refused out-of-order completion.

The runtime development-only flag mechanism is `setDevFlagOverride('workflow-dependent-due', true)` from `@/platform/flags`. It is also represented in development browser storage as `lantern:feature-flags`, for example `{"workflow-dependent-due":true}`. Remove that override or set it to `false` to review the flag-off state. Production ignores this development override and the flag defaults to off.

## Required changes

1. **Name the earlier step, not just “Previous step completed.”** An advisor needs to see the actual link immediately: for example, “Due 2 days after *Prepare client file* is completed.” The existing control does not show a predecessor picker or the predecessor’s name, so the relationship is too abstract even though the system correctly uses the immediate prior step.

2. **Make the timing rule read as one clear sentence.** The current inline row breaks into small fragments — “Based on / Previous step completed / Direction / After / Amount / 2 / Unit / Days.” Keep the existing fields and information structure, but group and space them so the result reads naturally, with an explicit short summary beneath it. This will also make the keyboard focus path easier to understand.

3. **Keep the refusal beside the blocked step and move focus to it.** “Finish ‘Prepare client file’ before completing this step.” is good plain language and should stay. Today it appears as a generic page-level alert far above the button that was pressed. Present that same message directly with the blocked step/action, retain the alert announcement, and put focus there after the refused click.

## Passed review points

- Light-theme contrast and the existing raised-card visual language are sound.
- The native labels and source order follow the visible control sequence.
- A completed predecessor recalculates the open dependent’s displayed due date.
- The canonical completion path refused the dependent step without marking it complete.
- With the flag off, no timing card, timing copy, or related control remains in the editor.

DESIGN-VERDICT: CHANGES-3
