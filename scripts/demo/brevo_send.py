#!/usr/bin/env python3
"""Send the demo client emails TO Sarah's real inbox via Brevo (works immediately,
unlike IMAP APPEND which the new-account anti-abuse lock blocks). Keeps the real client
display NAMES; uses a Brevo-verified domain for the address so it delivers cleanly to
Outlook (DKIM-aligned). Usage: brevo_send.py test   (send only #1)  |  brevo_send.py all"""
import sys, os, re, json, urllib.request, time
from inbox_emails import EMAILS

# Key is NOT hardcoded (no secrets in the repo). Provide it via env:
#   BREVO_API_KEY=... python3 brevo_send.py all
# It also lives in ~/.claude/.../memory/reference_brevo.md and /etc/form-handler.env.
def _load_key():
    k = os.environ.get("BREVO_API_KEY")
    if k:
        return k.strip()
    try:
        for line in open("/etc/form-handler.env"):
            if line.startswith("BREVO_API_KEY="):
                return line.split("=", 1)[1].strip()
    except Exception:
        pass
    raise SystemExit("Set BREVO_API_KEY env var (see reference_brevo.md).")

API_KEY = _load_key()
SENDER_DOMAIN = "jamesondaines.com"   # Brevo-verified -> good Outlook deliverability
TO = {"email": "sarah.morgan.cfp@outlook.com", "name": "Sarah Morgan"}

def slug(name):
    s = re.sub(r"[^a-z0-9]+", ".", name.lower()).strip(".")
    return s

def send_one(name, subject, body):
    local = slug(name)
    sender = {"name": name, "email": f"{local}@{SENDER_DOMAIN}"}
    payload = {
        "sender": sender,
        "to": [TO],
        "replyTo": sender,
        "subject": subject,
        "textContent": body,
    }
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=json.dumps(payload).encode(),
        headers={"api-key": API_KEY, "Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        r = urllib.request.urlopen(req)
        out = json.load(r)
        return True, sender["email"], out.get("messageId", "")
    except urllib.error.HTTPError as e:
        return False, sender["email"], f"HTTP {e.code}: {e.read().decode()[:200]}"

mode = sys.argv[1] if len(sys.argv) > 1 else "test"
items = EMAILS[:1] if mode == "test" else EMAILS
ok = 0
for (fname, faddr, subj, days, unread, body) in items:
    success, addr, info = send_one(fname, subj, body)
    print(f"  {'OK ' if success else 'ERR'} {fname:22s} <{addr:38s}> | {subj[:38]:38s} | {info}")
    if success:
        ok += 1
    time.sleep(0.5)
print(f"\nSENT {ok}/{len(items)} via Brevo to {TO['email']}")
