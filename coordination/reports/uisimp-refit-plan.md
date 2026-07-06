codex
Read-only report. I fetched `origin` and did not change files.

**Bottom Line**
The new system would classify this cleanup as **Tier B** overall. That is right, because this diff changes real app behavior in `Spine`, `ConfidentialityModeSettings`, and the new `InfoHelp` control.

But the field test found two system problems:

1. The classifier is too strict for connector UI files under `src/platform/connectors/**`. It calls simple tooltip/header changes **Tier B** only because of the folder name. These hunks should be **Tier S**.
2. The handle rules would catch or expose real re-land problems. Most important: the old privacy-card handle moved onto a wrapper `<div>`, while the real click target got a new `-select` handle. That breaks the “handle is the real control” rule.

**Classification**
| Files | Script Tier | Correct? |
|---|---:|---|
| screenshots + `INDEX.md` | none | yes |
| `src/app/shell/layout/Spine.tsx` | B | yes: adds state, toggle, event behavior |
| `src/app/shell/layout/Spine.test.tsx` | S | no: test-only file should be none |
| `src/features/settings/ConfidentialityModeSettings.tsx` | B | yes: changes button structure, disabled state, click target |
| `src/ui/InfoHelp.tsx` | B | yes: new control with event handling |
| `ApiKeySetupCard.tsx` | S | yes |
| `ChooseStartScene.tsx` | S | mostly yes, but nested `InfoHelp as="span"` inside card buttons is behavior/a11y-adjacent |
| `ConnectScene.tsx` | S | yes |
| all 14 `src/platform/connectors/**/*.tsx` files | B | no: these hunks are header/helper-text tooltip changes, should be S |
| tests under `tests/**` | none | yes |

**Handle Findings**
Static handle dry-run against the new baseline:

```text
added handles: 2
removed unauthorized handles: 18
new duplicate handles: 0
token guard: 0 new hard-coded colors
```

New handles are fine:
```text
spine-clients-toggle
confidentiality-mode-${}-select
```

Must fix before re-land:

```diff
// src/app/shell/layout/Spine.tsx
- <button key={m.id} type="button"
+ <button key={m.id} type="button" data-testid={`spine-client-row-${m.id}`}
```

Privacy-card handle should stay on the real button, not the wrapper:

```diff
- <div data-testid={`confidentiality-mode-${card.mode}`} ...>
+ <div ...>

- <button data-testid={`confidentiality-mode-${card.mode}-select`} ...>
+ <button data-testid={`confidentiality-mode-${card.mode}`} ...>
```

Then update the new tests to click the old stable handle again, not `-select`.

Also preserve the UI-system branch handles when resolving re-land conflicts:

```text
connect-m365-button
connect-onedrive-button
connect-wealthbox-button
wealthbox-api-key-input
onedrive-sync-now
onedrive-disconnect*
onedrive-data-remains
onedrive-delete-files-checkbox
confirm-dialog*
```

**Exact Re-Land Plan**
1. Start from current `origin/lantern-plus`.
2. Apply the UI Iteration System first: commits `84806c8e`, `4db63922`.
3. Apply the UI simplification commits after that.
4. Resolve conflicts by preserving every existing `data-testid` from the system branch.
5. Make the two required code fixes above: `spine-client-row-${m.id}` and privacy-card handle-on-real-button.
6. Keep connector button/input handles while applying tooltip/header edits.
7. Run:
   ```bash
   node scripts/ui-system/classify-tier.mjs --base origin/lantern-plus
   node scripts/ui-system/handle-guard.mjs
   node scripts/ui-system/token-guard.mjs
   npm run gate
   ```
8. Because final tier is **B**, also run real Windows verification on the Legion.

**Recommended System Fixes**
For the classifier itself:

```diff
// scripts/ui-system/lib/classify.mjs
+ if (/\.(test|spec)\.tsx?$/.test(f)) return 'NONE';
+ if (f.startsWith('src/platform/connectors/') && /\.tsx?$/.test(f)) return 'UICODE';
```

That keeps real platform logic strict, but lets connector screen-only changes be judged by their actual changed lines.
tokens used
124,498
Read-only report. I fetched `origin` and did not change files.

**Bottom Line**
The new system would classify this cleanup as **Tier B** overall. That is right, because this diff changes real app behavior in `Spine`, `ConfidentialityModeSettings`, and the new `InfoHelp` control.

But the field test found two system problems:

1. The classifier is too strict for connector UI files under `src/platform/connectors/**`. It calls simple tooltip/header changes **Tier B** only because of the folder name. These hunks should be **Tier S**.
2. The handle rules would catch or expose real re-land problems. Most important: the old privacy-card handle moved onto a wrapper `<div>`, while the real click target got a new `-select` handle. That breaks the “handle is the real control” rule.

**Classification**
| Files | Script Tier | Correct? |
|---|---:|---|
| screenshots + `INDEX.md` | none | yes |
| `src/app/shell/layout/Spine.tsx` | B | yes: adds state, toggle, event behavior |
| `src/app/shell/layout/Spine.test.tsx` | S | no: test-only file should be none |
| `src/features/settings/ConfidentialityModeSettings.tsx` | B | yes: changes button structure, disabled state, click target |
| `src/ui/InfoHelp.tsx` | B | yes: new control with event handling |
| `ApiKeySetupCard.tsx` | S | yes |
| `ChooseStartScene.tsx` | S | mostly yes, but nested `InfoHelp as="span"` inside card buttons is behavior/a11y-adjacent |
| `ConnectScene.tsx` | S | yes |
| all 14 `src/platform/connectors/**/*.tsx` files | B | no: these hunks are header/helper-text tooltip changes, should be S |
| tests under `tests/**` | none | yes |

**Handle Findings**
Static handle dry-run against the new baseline:

```text
added handles: 2
removed unauthorized handles: 18
new duplicate handles: 0
token guard: 0 new hard-coded colors
```

New handles are fine:
```text
spine-clients-toggle
confidentiality-mode-${}-select
```

Must fix before re-land:

```diff
// src/app/shell/layout/Spine.tsx
- <button key={m.id} type="button"
+ <button key={m.id} type="button" data-testid={`spine-client-row-${m.id}`}
```

Privacy-card handle should stay on the real button, not the wrapper:

```diff
- <div data-testid={`confidentiality-mode-${card.mode}`} ...>
+ <div ...>

- <button data-testid={`confidentiality-mode-${card.mode}-select`} ...>
+ <button data-testid={`confidentiality-mode-${card.mode}`} ...>
```

Then update the new tests to click the old stable handle again, not `-select`.

Also preserve the UI-system branch handles when resolving re-land conflicts:

```text
connect-m365-button
connect-onedrive-button
connect-wealthbox-button
wealthbox-api-key-input
onedrive-sync-now
onedrive-disconnect*
onedrive-data-remains
onedrive-delete-files-checkbox
confirm-dialog*
```

**Exact Re-Land Plan**
1. Start from current `origin/lantern-plus`.
2. Apply the UI Iteration System first: commits `84806c8e`, `4db63922`.
3. Apply the UI simplification commits after that.
4. Resolve conflicts by preserving every existing `data-testid` from the system branch.
5. Make the two required code fixes above: `spine-client-row-${m.id}` and privacy-card handle-on-real-button.
6. Keep connector button/input handles while applying tooltip/header edits.
7. Run:
   ```bash
   node scripts/ui-system/classify-tier.mjs --base origin/lantern-plus
   node scripts/ui-system/handle-guard.mjs
   node scripts/ui-system/token-guard.mjs
   npm run gate
   ```
8. Because final tier is **B**, also run real Windows verification on the Legion.

**Recommended System Fixes**
For the classifier itself:

```diff
// scripts/ui-system/lib/classify.mjs
+ if (/\.(test|spec)\.tsx?$/.test(f)) return 'NONE';
+ if (f.startsWith('src/platform/connectors/') && /\.tsx?$/.test(f)) return 'UICODE';
```

That keeps real platform logic strict, but lets connector screen-only changes be judged by their actual changed lines.
