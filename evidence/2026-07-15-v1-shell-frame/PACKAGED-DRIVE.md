# V1 shell frame packaged-drive evidence

Date: 2026-07-15 UTC

Product build reviewed: `dddec8efeb3f2c6cdbb21aa31d978739dfae8cdf`

This was a real Linux Tauri debug-app drive through the app's native development bridge. The renderer came from this worktree's Vite server on port 5174. The existing debug binary was launched with `scripts/crm-loop/launch-app.sh` on bridge port 9274 and private X display `:224`. This lane changed no Rust code.

The firm identity used for the visual fixture was `Northstar Advisory`, eight people, with advisor `Sarah Mitchell`. It contains no client data and exists only in the isolated drive workspace.

## Bench preflight

Command:

```text
ss -ltnp '( sport = :5174 )'
```

Result: no listener; the shared bench was free before launch.

App URL reported by the real desktop bridge:

```text
http://localhost:5174/
```

## Flag OFF: legacy shell

The default flag value was left OFF for the first launch.

Observed test IDs before any override:

```text
app-header = present
sidebar = present
command-palette-button = present
v1-shell-frame = absent
```

Screenshot: `01-flag-off-legacy-shell.png`

SHA-256: `3652b893db8fa90608f6dd1dc1298c4199f70de763d812c90a6c637375a57cde`

## Flag ON: v1 shell

Development overrides used for the merged visual drive:

```text
v1-shell-frame = true
shared-client-bar = true
```

`shared-client-bar` was enabled so this build's current minimal shared-client bar could be seen inside this lane's reserved slot. This build does not contain the later P0-C picker and quick-action visuals, so this drive does not claim to accept those visuals. The shell-frame decision itself remained controlled by `v1-shell-frame`.

After selecting Clients through `v1-shell-nav-matters`, the desktop bridge returned:

```json
{
  "active": "Clients",
  "clientBar": 1,
  "clientSlot": true,
  "firm": "Northstar Advisory\nFirm workspace · 8 people\n",
  "frame": true,
  "legacy": false,
  "topbar": "Workspace/Clients\n\nUsing local AI\n\n\nSearch clients, tasks, meetings, and conversations\nK\n\nSM\n"
}
```

Screenshot: `02-flag-on-v1-shell-clients.png`

SHA-256: `3a68b2fc9ffac72c8721778b0693d1de191a40bb754e87746cd73717f85bc0cb`

## Navigation and command trigger

The visible command trigger was clicked through the desktop bridge. Result:

```json
{
  "dialogs": [
    "Command PaletteType a command or search across the appescfileNew DocumentCtrl+NSave FileCtrl+SClose TabCtrl+WviewToggle "
  ],
  "paletteVisible": true
}
```

The Ask destination was then clicked through `v1-shell-nav-search`. Result:

```json
{
  "active": "Ask",
  "clientBars": 1,
  "frame": true,
  "slots": 1
}
```

This confirms registry-driven navigation works and the shell owns exactly one slot containing exactly one current shared-client bar. It does not claim that the later P0-C picker or quick actions were integrated in this build.

## Flag OFF again: legacy restoration

The `v1-shell-frame` override was changed to false and the real desktop renderer was reloaded. Result:

```json
{
  "frame": false,
  "legacyCommand": true,
  "legacyHeader": true,
  "legacySidebar": true
}
```

Screenshot: `03-flag-off-legacy-shell-after-drive.png`

SHA-256: `a595c4bae7028f39bf7dcfe744f2a67eda74ddb48d21428c5e699535a7b8c9df`

Verdict: PASS for this lane's frame contract. Flag ON renders the v1 shell, navigation and the command palette work, the current shared-client bar occupies the reserved row exactly once, and flag OFF restores the legacy shell. The later P0-C picker/action visual remains outside this build and was not accepted by this drive.
