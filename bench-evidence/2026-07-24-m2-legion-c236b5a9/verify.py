#!/usr/bin/env python3
"""Fail closed on M2 continuation receipt and screenshot integrity."""
import hashlib, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
receipt = json.loads((ROOT / 'receipt.json').read_text())
errors = []
def require(condition, message):
    if not condition: errors.append(message)

require(receipt.get('source', {}).get('revision') == 'c236b5a9cde4d3dfbacdd66ef87cf5e51295ac58', 'wrong revision')
build = receipt.get('build', {})
require(build.get('one_build_count') == 1, 'one build count is not one')
require(build.get('second_build_ran') is False and build.get('no_retry_fact') is True, 'retry fact missing')
cont = receipt.get('continuation', {})
require(cont.get('original_ended_monitor_job') == '20260723-144123-cziaxxxx', 'wrong original monitor job')
require(cont.get('monitor_or_drive_continuation') is True and cont.get('not_build_attempt_two') is True, 'continuation fact missing')
m2 = receipt.get('milestones', {}).get('M2', {})
require(m2.get('verdict') == 'PARTIAL', 'M2 must be partial')
states = {x.get('id'): x.get('status') for x in m2.get('assertions', [])}
require(states == {'M2.1': 'PASS', 'M2.2': 'BLOCKED', 'M2.3': 'NOT_RUN', 'M2.4': 'NOT_RUN', 'M2.5': 'NOT_RUN'}, 'unexpected M2 assertion states')
require(receipt.get('milestones', {}).get('M3', {}).get('verdict') == 'NOT_RUN', 'M3 must not run')
require(receipt.get('milestones', {}).get('M5', {}).get('verdict') == 'NOT_RUN', 'M5 must not run')
require(receipt.get('stop_point', {}).get('assertion') == 'M2.2', 'wrong stop point')
require(receipt.get('safety', {}).get('no_send_occurred') is True, 'send safety missing')
for name, expected in receipt.get('screenshots', {}).items():
    path = ROOT / 'screenshots' / name
    actual = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
    require(actual == expected, f'bad or missing screenshot: {name}')
if errors:
    print('FAIL')
    print('\n'.join(errors))
    sys.exit(1)
print('PASS: receipt, ordered stop, one-build rule, and screenshots verified')
