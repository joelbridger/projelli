# Legion Bench Automation

**Current as of 2026-07-09.** This is the short guide for driving the Lantern/Keepance app on the Legion Windows bench.

## Use this first: the dev bridge

The primary control path is the app's dev-only HTTP bridge:

- It listens inside the app on `127.0.0.1:9250`.
- It is defined in `src-tauri/src/dev_bridge.rs`.
- It is compiled only for debug builds: `#[cfg(debug_assertions)]`.
- It is not present in release builds.

From the server, call it through SSH:

```bash
ssh james@100.127.67.22 "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/health').Content"
```

Expected response:

```json
{"ok":true,"port":9250}
```

All bridge endpoints are `GET`. Normal responses are JSON shaped like:

```json
{"ok":true,"result":...}
```

Errors are:

```json
{"ok":false,"error":"..."}
```

Default timeout is 5000 ms. Add `timeout_ms=15000` when an action needs longer.

## Dev bridge endpoints

| Endpoint | Use |
|---|---|
| `/health` | Check that the bridge is alive. |
| `/testids` | List every `data-testid` currently on screen. |
| `/click?testid=<id>` | Click the element with that `data-testid`. |
| `/fill?testid=<id>&text=<text>` | Set an input, textarea, or editable element, then fire input/change events. URL-encode the text. |
| `/text?testid=<id>` | Read visible text from a test id. |
| `/text?selector=<css>` | Read visible text from a CSS selector. |
| `/exists?testid=<id>` | Return whether a test id exists. |
| `/url` | Return `window.location.href`. |
| `/eval?js=<url-encoded-js>` | Run arbitrary JavaScript in the app window. |

Examples:

```bash
ssh james@100.127.67.22 "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/testids').Content"
ssh james@100.127.67.22 "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/click?testid=spine-nav-clients').Content"
ssh james@100.127.67.22 "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/exists?testid=ask-input').Content"
```

For custom app events, use `/eval`. Example:

```bash
ssh james@100.127.67.22 "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9250/eval?js=window.dispatchEvent(new%20CustomEvent(%22lantern%3Aopen-client-settings%22%2C%7Bdetail%3A%7BmatterId%3A%22matter_123%22%7D%7D))').Content"
```

## Do not chase CDP on this bench

WebView2 remote debugging on port `9223` is dead on this Legion bench. WebView2 v150 hardened the path, so the old CDP/WebView2 driver no longer works here.

Do not spend time trying to revive:

- `http://127.0.0.1:9223/json/version`
- `scripts/desktop-drive.mjs` against this bench
- old notes that say "drive over CDP"

The dormant CDP code in `src-tauri/src/webview_env.rs` is harmless. Leave it alone unless a separate product-code task asks for it.

## Bridge caveats

- Empty-state screens may have no input boxes. For example, search boxes can render only after there is content to search.
- Use `/testids` before assuming a control exists.
- Use `/eval` for app-internal actions that are not exposed as buttons.
- URL-encode JavaScript and text. If quoting gets messy, write a tiny script on the Legion and call it from PowerShell.

## Fallback: the PyAutoGUI screen agent

Use the PyAutoGUI agent when you need the real Windows desktop:

- Browser windows
- OAuth pages
- Native file pickers
- Native dialogs
- Real screenshots
- Anything outside the app's webview

It runs as the `LegionAgent` scheduled task:

- File on the bench: `C:\agent\legion_agent.py`
- Process: `pythonw`
- Port: `127.0.0.1:8765`
- Screen size: `2560x1600`

Check it:

```bash
ssh james@100.127.67.22 "(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8765/health').Content"
```

Useful endpoints:

| Endpoint | Use |
|---|---|
| `/health` | Check that the agent is alive. |
| `/size` | Return the screen size. |
| `/shot` | Return a PNG screenshot of the real desktop. |
| `/click?x=<x>&y=<y>` | Click real screen coordinates. |
| `/doubleclick?x=<x>&y=<y>` | Double-click real screen coordinates. |
| `/rightclick?x=<x>&y=<y>` | Right-click real screen coordinates. |
| `/move?x=<x>&y=<y>` | Move the mouse. |
| `/type?text=<text>` | Type literal text. |
| `/key?name=<key>` | Press one key, like `enter`, `tab`, `esc`, or `backspace`. |
| `/hotkey?keys=ctrl,l` | Press a key combo. |
| `/scroll?amount=-500` | Scroll. Negative scrolls down. |
| `/paste?text=<text>` | Put text on the clipboard and paste it. This is the reliable fill path for long text. |

Session notes may call the last action `/fill`; the checked-in and live agent currently exposes it as `/paste`.

## Screenshot rule

SSH PowerShell screenshots come back blank because SSH is not attached to the live desktop.

Only this sees the real screen:

```bash
ssh james@100.127.67.22 "Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8765/shot' -OutFile C:\agent-shot.png"
scp james@100.127.67.22:C:/agent-shot.png /tmp/legion-shot.png
```

Use the dev bridge for precise app actions. Use PyAutoGUI for the real operating-system surface.

## Field notes — first production session (2026-07-09, coordinator-14)

Proven end-to-end tonight: /health, /testids (~26KB of labels with the full client list), /eval, /click, /text. Drove client selection, tab navigation, email search ("Roth conversion" → 5 results), settings navigation, and Ask submission entirely by label — zero screenshots needed for reading state.

Gotchas found live (patterns to reuse):
1. **Radix/portal dropdown menus ignore element.click().** The `/click?testid=` route (and eval `.click()`) does nothing on Radix DropdownMenu triggers. Working pattern: ask the bridge for the trigger's real screen position, then click with the pyautogui agent:
   `/eval` → `(window.screenX + rect.x + rect.width/2) * devicePixelRatio` (add `window.outerHeight - window.innerHeight` to y for the title bar), then `legdrive.sh click X Y`. Menu items: same pattern.
2. **React inputs need the native-setter trick** (plain `.value=` is ignored): get `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set`, call it, then dispatch `new Event('input',{bubbles:true})`. Works for search boxes and the Ask composer. cmdk/command-palette inputs may need real key events instead.
3. **PowerShell → SSH output is not always valid UTF-8.** Decode with `errors="replace"` on the reading side (the `€`/dash class of characters otherwise kills a strict JSON parse).
4. **A helper wrapper beats raw Invoke-WebRequest quoting.** URL-encode the JS on the Linux side (python urllib.parse.quote) and pass one clean URL over ssh; inline PowerShell quoting of JS reliably mangles it.
