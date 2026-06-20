# legion_agent.py — full-desktop control agent for the Legion bench.
# Runs IN the interactive logged-in session (via a scheduled task) so its
# screenshots + mouse + keyboard reach the REAL visible desktop (native dialogs,
# the browser, any app). Binds localhost only; reached from the server via an
# SSH tunnel over Tailscale. Pairs with the CDP bridge (precise in-app clicks).
#
# Endpoints (all GET, query params):
#   /health
#   /size                         -> {"w":..,"h":..}
#   /shot                         -> PNG of the whole screen
#   /click?x=&y=                  /  /doubleclick?x=&y=  /  /rightclick?x=&y=
#   /move?x=&y=
#   /type?text=...                (types literal text)
#   /key?name=enter               (single key: enter,tab,esc,backspace,delete,up,down,...)
#   /hotkey?keys=ctrl,l           (key combo)
#   /scroll?amount=-500
#   /paste?text=...               (sets clipboard then ctrl+v — reliable for long/odd text)
import io, json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs, unquote_plus
import pyautogui
pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0.05
try:
    import pyperclip
    HAVE_CLIP = True
except Exception:
    HAVE_CLIP = False


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body=b'', ctype='text/plain'):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        p = u.path
        try:
            if p == '/health':
                self._send(200, 'ok')
            elif p == '/size':
                w, h = pyautogui.size()
                self._send(200, json.dumps({'w': w, 'h': h}))
            elif p == '/shot':
                img = pyautogui.screenshot()
                buf = io.BytesIO()
                img.save(buf, 'PNG')
                self._send(200, buf.getvalue(), 'image/png')
            elif p in ('/click', '/doubleclick', '/rightclick', '/move'):
                x, y = int(q['x']), int(q['y'])
                if p == '/click':
                    pyautogui.click(x, y)
                elif p == '/doubleclick':
                    pyautogui.doubleClick(x, y)
                elif p == '/rightclick':
                    pyautogui.rightClick(x, y)
                else:
                    pyautogui.moveTo(x, y)
                self._send(200, f'{p} {x},{y}')
            elif p == '/type':
                t = unquote_plus(q.get('text', ''))
                pyautogui.typewrite(t, interval=0.01)
                self._send(200, f'typed {len(t)} chars')
            elif p == '/key':
                pyautogui.press(q['name'])
                self._send(200, 'key ' + q['name'])
            elif p == '/hotkey':
                keys = q['keys'].split(',')
                pyautogui.hotkey(*keys)
                self._send(200, 'hotkey ' + '+'.join(keys))
            elif p == '/scroll':
                pyautogui.scroll(int(q['amount']))
                self._send(200, 'scroll ' + q['amount'])
            elif p == '/paste':
                t = unquote_plus(q.get('text', ''))
                if HAVE_CLIP:
                    pyperclip.copy(t)
                    pyautogui.hotkey('ctrl', 'v')
                    self._send(200, f'pasted {len(t)} chars')
                else:
                    pyautogui.typewrite(t, interval=0.01)
                    self._send(200, f'typed(no-clip) {len(t)} chars')
            else:
                self._send(404, 'unknown endpoint')
        except Exception as e:
            self._send(500, repr(e))


if __name__ == '__main__':
    HTTPServer(('127.0.0.1', 8765), H).serve_forever()
