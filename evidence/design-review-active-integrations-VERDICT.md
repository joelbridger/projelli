# Design review — Active integrations

**Build reviewed:** `003c7bc74bc813a939ef2abc6d20ea1c9645a403`

**Review date:** 2026-07-18  
**Scope:** the new Account/Settings section only. The frozen navigation and information architecture were not reviewed.

## Fresh live review

This was a new browser run from this worktree:

- Fresh X display: `:122`
- Fresh Vite port: `5288`
- New disposable Google Chrome profile with `--password-store=basic`
- Flag on: the sanctioned development-only `setDevFlagOverride('active-integrations', true)` path, which writes `localStorage['lantern:feature-flags']` as `{"active-integrations":true}`. Remove the override with `setDevFlagOverride('active-integrations', undefined)` (or remove that storage item) to return to the shipped default-off state. Production ignores this development override.
- The connected Wealthbox review state used a disposable native-command bridge only to report that one synthetic connector as connected. It drove the real Account host, real public connection-card registry, real connector renderer, and real confirmation dialog. No app source, registry, or test file was changed.

Teardown was proven before this verdict: the owned Chrome process, Vite server, and X display stopped; ports `9388` and `5288` were free; display `:122` was free; and the disposable profile was removed.

## Screens reviewed

| Screen | Evidence |
| --- | --- |
| Flag on — visible cards | [01-cards-visible.png](design-review-active-integrations/01-cards-visible.png) |
| Connected-card disconnect confirmation | [02-disconnect-confirmation.png](design-review-active-integrations/02-disconnect-confirmation.png) |
| No connected providers — required empty state is not reached | [03-no-connections-no-empty-state.png](design-review-active-integrations/03-no-connections-no-empty-state.png) |
| Flag off — no section or tab trace | [04-flag-off-no-trace.png](design-review-active-integrations/04-flag-off-no-trace.png) |

## What passed

- The flag is genuinely dark by default. With the runtime override removed, the Account window had no Integrations tab, no Active integrations section, and no matching title text.
- The modal, cards, light surface, border weight, type scale, and destructive confirmation all fit the existing Account visual language. The confirmation is especially clear about the consequence: it removes the Wealthbox key and deletes the imported Wealthbox households and client data, while leaving the advisor's own files and other matters alone.
- The destructive choice has an ordinary button name and a clear red treatment. The confirmation also has a visible cancel path.

## Required changes

1. **Make “Active integrations” mean active.** With no providers connected, the live screen still renders all 16 provider setup forms, including “Connect Microsoft 365.” The required empty state is therefore unreachable. A card in this section must appear only when its connector can prove a current connection; if none can, show the supplied empty state. Do not call an unconnected setup option active.

2. **Stop rendering each connector twice.** The card calls its connector's full renderer once for “status” and again for “disconnect.” The result is two identical Microsoft 365 forms and, in the connected Wealthbox drive, two copies of status/actions behind the confirmation. This is visual clutter and makes keyboard/screen-reader traversal repeat the same controls with no useful distinction. Give the public card doorway separate, compact status and disconnect renderers, or have one connector-owned card renderer. Each control needs one clear visible label and one place in the focus order.

3. **Fix the advisor-facing names before exposing this section.** The card heading visibly says `connectors.microsoft365`, which is an internal translation key rather than a product name. The generic “Status, access, and disconnect are managed by this integration” also promises a meaningful state while the card below only offers setup. Render the actual provider name, use plain current-state language such as “Connected” only when the connector proves it, and reserve the disconnect wording for a connected card.

## Truth-in-UI result

**Not ready.** The individual Wealthbox confirmation is honest, but the section's central promise is not: it labels every possible integration as active and has no live route to the no-integrations state. The duplicated renderer also means a card does not cleanly separate what it proves from the action it offers.

DESIGN-VERDICT: CHANGES-3

## Re-verdict — 2026-07-18

**Pass.** The three requested cures now hold on the live desktop screen.

### Fresh evidence

| Screen | Evidence |
| --- | --- |
| One genuinely connected provider, with its connector-owned panel mounted once | [05-rereview-connected-single-form.png](design-review-active-integrations/05-rereview-connected-single-form.png) |
| The driven zero-connection route, with no card or setup form shown | [06-rereview-empty-state-reached.png](design-review-active-integrations/06-rereview-empty-state-reached.png) |

### What I verified on screen

1. The fresh desktop workspace reported Microsoft 365 and the other 14 remote providers as unconnected. None appeared in **Active integrations**. The one real local connection, Ollama, appeared with the honest **Connected** label; its provider name is rendered as `Ollama`, not a translation key.
2. The real connected Ollama card has exactly one connector-owned management panel and one **Check Ollama connection** control. There is no repeated copy of the form, status panel, or action in the visible card or its focusable controls.
3. I then drove the genuine zero-connection branch. This bench has a real local Ollama service, so I used a disposable, in-memory browser fetch interceptor only for that service's connection probe, remounted the real Account tab, and confirmed the actual component rendered **No integrations connected** with no list, card, or setup form. No source, registry, or test file was changed; reloading restored the normal probe.

### Fresh-run and teardown proof

This re-review used the real desktop debug app with the current worktree served by Vite on `:5174`, an isolated bridge on `:9438`, a fresh workspace, and a private X display (`:388`). The feature used the sanctioned development-only `setDevFlagOverride('active-integrations', true)` path. The owned app, Vite server, X display, bridge port, and Vite port were all stopped/free after capture; the disposable workspace was not used for product data.

DESIGN-VERDICT: PASS
