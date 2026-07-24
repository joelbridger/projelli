#!/usr/bin/env python3
import hashlib, json
from pathlib import Path

root = Path(__file__).parent
r = json.loads((root / 'receipt.json').read_text())
assert r['terminal_product_verdict'] == 'NOT_TESTED'
assert r['stop_point']['reason'] == 'NOT_TESTED / VISIBLE APP DRIVE NOT PROVEN'
assert r['ownership']['input_director_count'] == 0
assert r['ownership']['keepance_dev_state'] != 'Running'
assert r['ownership']['lantern_before_launch_count'] == 0
assert r['camera']['passive_only'] and r['camera']['sole_listener'] == '127.0.0.1:8799'
assert r['helper']['fresh_pid'] and r['helper']['sole_listener'] == '127.0.0.1:8765'
assert r['visible_gate']['status'] == 'NOT_PROVEN' and not r['visible_gate']['after']
assert not r['network_and_credentials']['credential_contents_read']
assert not r['network_and_credentials']['credential_transferred']
assert all(x['status'] == 'NOT_RUN' for x in r['ordered_assertions'])
hashes = {r['camera']['fresh_frame']: r['camera']['fresh_frame_sha256']}
hashes.update(r['visible_gate']['before_hashes'])
for name, want in hashes.items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == want
print('NOT_TESTED: visible app drive not proven; credentials and A-E were not run')
