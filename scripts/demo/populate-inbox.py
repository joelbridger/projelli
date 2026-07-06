#!/usr/bin/env python3
"""Populate sarah.morgan.cfp@outlook.com's inbox with demo client emails via
IMAP APPEND (XOAUTH2). Kept as a fallback for when Microsoft's new-account IMAP
lock lifts; Brevo is the primary path today."""
import imaplib
import json
import os
import ssl
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formatdate

from inbox_emails import EMAILS

TOK = json.load(open(os.environ.get('IMAP_TOKEN_JSON', '/tmp/claude-1000/-home-jameson/dadc9abc-0cc3-4e6a-9a49-136a3006e1b0/scratchpad/token.json')))
ACCESS = TOK['access_token']
USER = 'sarah.morgan.cfp@outlook.com'


def xoauth2_string(user, token):
    return f"user={user}\x01auth=Bearer {token}\x01\x01"


ctx = ssl.create_default_context()
M = imaplib.IMAP4_SSL('outlook.office365.com', 993, ssl_context=ctx)
M.authenticate('XOAUTH2', lambda x: xoauth2_string(USER, ACCESS).encode())
print("IMAP authenticated as", USER)

now = datetime.now(timezone.utc)
ok = 0
for (fname, faddr, subj, days, unread, body) in EMAILS:
    msg = EmailMessage()
    msg['From'] = f"{fname} <{faddr}>"
    msg['To'] = f"Sarah Morgan <{USER}>"
    msg['Subject'] = subj
    dt = now - timedelta(days=days, hours=(days % 7) + 1)
    msg['Date'] = formatdate(dt.timestamp(), localtime=False)
    msg.set_content(body)
    flags = '' if unread else '(\\Seen)'
    res = M.append('INBOX', flags, imaplib.Time2Internaldate(dt.timestamp()), msg.as_bytes())
    print(f"  {'UNREAD' if unread else 'read  '} {fname:18s} | {subj[:40]:40s} -> {res[0]}")
    if res[0] == 'OK':
        ok += 1
    time.sleep(0.4)

M.logout()
print(f"\nAPPENDED {ok}/{len(EMAILS)} emails to {USER} inbox")
