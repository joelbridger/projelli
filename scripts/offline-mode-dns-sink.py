"""Small recording DNS forwarder for the Windows Offline Mode release gate."""
import json
import os
import socket
import socketserver
import struct
import threading
from datetime import datetime, timezone

LOG = os.environ.get("OFFLINE_GATE_DNS_LOG", "C:/offline-mode-gate/evidence/dns.jsonl")
UPSTREAM = os.environ.get("OFFLINE_GATE_DNS_UPSTREAM", "75.75.75.75")
lock = threading.Lock()

def qname(packet):
    try:
        count = struct.unpack("!H", packet[4:6])[0]
        if not count: return ""
        index, labels = 12, []
        while packet[index]:
            length = packet[index]; index += 1
            labels.append(packet[index:index + length].decode("ascii", "replace")); index += length
        return ".".join(labels)
    except Exception:
        return "<unparseable>"

def record(client, packet, transport):
    row = {"at": datetime.now(timezone.utc).isoformat(), "client": client[0], "transport": transport, "question": qname(packet)}
    with lock, open(LOG, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(row) + "\n")

def forward(packet):
    upstream = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    upstream.settimeout(4)
    try:
        upstream.sendto(packet, (UPSTREAM, 53))
        return upstream.recvfrom(65535)[0]
    finally:
        upstream.close()

class Udp(socketserver.BaseRequestHandler):
    def handle(self):
        packet, server = self.request
        record(self.client_address, packet, "udp")
        try: server.sendto(forward(packet), self.client_address)
        except Exception: pass

class Tcp(socketserver.BaseRequestHandler):
    def handle(self):
        header = self.request.recv(2)
        if len(header) != 2: return
        size = struct.unpack("!H", header)[0]
        packet = self.request.recv(size)
        record(self.client_address, packet, "tcp")
        try:
            reply = forward(packet)
            self.request.sendall(struct.pack("!H", len(reply)) + reply)
        except Exception: pass

class ThreadedUdp(socketserver.ThreadingMixIn, socketserver.UDPServer): allow_reuse_address = True
class ThreadedTcp(socketserver.ThreadingMixIn, socketserver.TCPServer): allow_reuse_address = True
class ThreadedUdpV6(ThreadedUdp): address_family = socket.AF_INET6
class ThreadedTcpV6(ThreadedTcp): address_family = socket.AF_INET6

if __name__ == "__main__":
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    # Windows Internet Connection Sharing owns IPv4 :53 on the Legion.  The
    # gate therefore uses IPv6 loopback, which is independent of that service
    # and still exercises the OS resolver without stopping a shared service.
    for server in (ThreadedUdpV6(("::1", 53), Udp), ThreadedTcpV6(("::1", 53), Tcp)):
        threading.Thread(target=server.serve_forever, daemon=True).start()
    threading.Event().wait()
