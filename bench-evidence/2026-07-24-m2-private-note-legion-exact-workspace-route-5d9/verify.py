#!/usr/bin/env python3
import hashlib, json, sys
from pathlib import Path

root = Path(__file__).parent
receipt = json.loads((root / 'receipt.json').read_text())
def fail(message):
    print(f'FAIL CLOSED: {message}')
    raise SystemExit(1)
if receipt.get('terminal_product_verdict') != 'NOT_TESTED': fail('verdict')
if receipt.get('credential_gate', {}).get('complete'): fail('credential gate dishonesty')
if any(receipt['credential_gate'].get(k) for k in ('credential_contents_read','credential_transferred','clipboard_credential','credential_typed')): fail('credential use')
if receipt['route'].get('hendricks_selected'): fail('dishonest route blocker')
for pair in ('command_bar','change_workspace','workspace_selector','native_dialog','exact_address_before_selection','shell_after_selection','hendricks_picker'):
    for name in receipt['route'][pair]:
        p = root / 'screenshots' / name
        if not p.is_file() or p.stat().st_size == 0: fail(f'missing {name}')
if receipt['product']['sha256'] != '62d3bf454bb84fa1799856719c1bf7e4f0248802d72832cd36c98b030e99c2e8': fail('app identity')
if not receipt['synthetic_workspace']['clone_identical_before_launch']: fail('clone')
if any(a['status'] != 'NOT_RUN' for a in receipt['assertions']): fail('later assertion ran')
print('PASS: fail-closed NOT_TESTED evidence is internally consistent')
