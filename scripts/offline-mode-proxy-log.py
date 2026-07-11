"""mitmproxy addon that records safe request metadata for the release gate."""
import json
import os
from datetime import datetime, timezone

LOG = os.environ.get("OFFLINE_GATE_PROXY_LOG", "C:/offline-mode-gate/evidence/proxy.jsonl")

def write(kind, flow):
    row = {"at": datetime.now(timezone.utc).isoformat(), "kind": kind}
    if getattr(flow, "request", None):
        request = flow.request
        row.update({"method": request.method, "host": request.host, "port": request.port, "path": request.path})
        row["websocketUpgrade"] = request.headers.get("upgrade", "").lower() == "websocket"
    with open(LOG, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(row) + "\n")

def request(flow): write("request", flow)
def websocket_start(flow): write("websocket-start", flow)
