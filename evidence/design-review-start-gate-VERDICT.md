# Workflow Start gate design review

## Scope and evidence

Pre-merge review of the Workflows Start control only. Its position in the
product was not reviewed.

The screen ran from this worktree in a fresh Xvfb display (`:252`) with Vite
on port `5187`, Google Chrome using a disposable profile and
`--password-store=basic`. The rendered CRM Workflows screen used disposable
live-record fixtures only; no product code or test code was changed.

- `evidence/design-review-start-gate-draft-disabled.png` — a draft template:
  Start workflow is disabled and explains that the template must be published.
- `evidence/design-review-start-gate-published-enabled.png` — the same screen
  with a published template: Start workflow is enabled.
- `evidence/design-review-start-gate-disabled-tab-skip.png` — keyboard Tab
  from the household selector skips the disabled Start workflow button and
  lands on Notifications.

## Assessment

| Criterion | Assessment |
| --- | --- |
| Explanation clarity | Pass. “Publish this workflow template before starting it” is short, direct, and says exactly what an advisor needs to do. |
| Visual consistency and light-theme contrast | Pass. The disabled and enabled controls match the surrounding small outlined buttons, use legible navy-on-white/light-pink treatments, and remain easy to tell apart. |
| Layout stability | Change 1. The explanatory sentence is only present while disabled, moving Start workflow down by about 20 pixels. The enabled and disabled states should keep the action in the same place. |
| Keyboard access and announcement | Change 2. The native disabled button cannot receive keyboard focus. Tab skips it, so its `aria-describedby` explanation cannot be announced from the control. The requested focused-disabled-control state therefore cannot be shown. Use a focusable `aria-disabled` control that prevents activation, or another accessible pattern that makes the reason discoverable by keyboard. |

DESIGN-VERDICT: CHANGES-2

## Re-review — 2026-07-18

Fresh Chrome screenshots were taken from the current worktree using the real
`LiveWorkflows` screen on a disposable Xvfb display. The draft and published
states used the same Annual review template and household fixture.

- `evidence/design-review-start-gate-rereview-draft-disabled.png` — draft
  state. The explanation is visible and Start workflow is blocked.
- `evidence/design-review-start-gate-rereview-disabled-focused.png` — the
  same draft state after keyboard Tab reaches Start workflow. Its visible focus
  ring and linked explanation are both present.
- `evidence/design-review-start-gate-rereview-published-enabled.png` —
  published state. Start workflow is enabled and no explanation is shown.

| Criterion | Re-review result |
| --- | --- |
| Layout stability | Pass. Start workflow was at `x=528.19, y=385.34` in both states; the previously observed vertical jump is gone. |
| Keyboard focus and explanation | Pass. Keyboard Tab reached the `aria-disabled` Start workflow control. Chrome's accessibility tree reported it as disabled, focusable, focused, and described by “Publish this workflow template before starting it.” |
| Enabled-state cleanliness | Pass. The reserved explanation row is hidden from both the screen and assistive technology when a template is published; Start has no description link in that state. |
| Focused visual state | Pass. The focused draft screenshot shows the control's visible focus ring, while activation remains blocked. |

Focused regression test: `npx vitest run src/features/crm-workflows/Workflows.startGate.test.tsx` — 11 passed.

Teardown: the disposable Xvfb display, Vite server, and Chrome profile were
stopped; both review-only ports were confirmed closed.

DESIGN-VERDICT: PASS
