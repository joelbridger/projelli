#!/usr/bin/env python3
# Static file server for the onboarding preview that disables browser caching.
# Plain `python -m http.server` sends only Last-Modified, which triggers browser
# heuristic caching -> stale scene files (the "double logo" bug). no-store fixes it.
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial

DIRECTORY = sys.argv[2] if len(sys.argv) > 2 else "/tmp/onboard"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8902


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    handler = partial(NoCacheHandler, directory=DIRECTORY)
    with ThreadingHTTPServer(("0.0.0.0", PORT), handler) as httpd:
        print(f"no-cache server on :{PORT} serving {DIRECTORY}", flush=True)
        httpd.serve_forever()
