#!/usr/bin/env python3
"""Fail closed for this non-product, pre-credential control-gate stop."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).parent
receipt = json.loads((root / "receipt.json").read_text())

assert receipt["terminal_product_verdict"] == "NOT_TESTED"
assert receipt["stop_point"]["reason"] == "NOT_TESTED / VISIBLE GO AND APP SHELL DRIVE NOT PROVEN"
assert receipt["ownership"]["keepance_dev_state"] != "Running"
assert receipt["ownership"]["lantern_before_launch_count"] == 0
assert receipt["ownership"]["input_director_count"] == 0
assert not receipt["ownership"]["build_or_installer_chain_active"]
assert not receipt["ownership"]["other_remote_control_owner"]
assert not receipt["ownership"]["ambiguous_owner"]
assert receipt["camera"]["passive_only"]
assert receipt["camera"]["sole_listener"] == "127.0.0.1:8799"
assert receipt["camera"]["script_sha256"] == "026811c25cff6e5f211195369e7617b3f4b8b7bf222adb83e47e0ef84e35509f"
assert receipt["helper"]["fresh_pid"] != receipt["helper"]["previous_pid"]
assert receipt["helper"]["sole_listener"] == "127.0.0.1:8765"
assert receipt["helper"]["script_sha256"] == "55261f488a6a7b2cf8607847ac4f7c68b7e6a4584d691c9996df84aefa8fbc01"
assert receipt["synthetic_workspace"]["identical"]
assert receipt["visible_gate"]["status"] == "BLOCKED_BEFORE_GO"
assert receipt["visible_gate"]["views_agree"]
assert not receipt["visible_gate"]["pointer_inside_pane"]
assert not receipt["visible_gate"]["scrollbar_moved"]
assert not receipt["visible_gate"]["go_fully_visible"]
assert receipt["visible_gate"]["go_click_count"] == 0
assert not receipt["visible_gate"]["credential_transfer_after_complete_gate"]
assert not receipt["network_and_credentials"]["credential_contents_read"]
assert not receipt["network_and_credentials"]["credential_transferred"]
assert not receipt["network_and_credentials"]["clipboard_credential"]
assert not receipt["network_and_credentials"]["credential_typed"]
assert all(item["status"] == "NOT_RUN" for item in receipt["ordered_assertions"])
assert receipt["safety"] == {"no_build": True, "no_install": True, "no_provider": True, "no_send": True, "no_seat_or_staff_action": True, "whole_firm_closed": True, "no_m3": True, "credentials_not_used": True}

expected = {receipt["camera"]["fresh_frame"]: receipt["camera"]["fresh_frame_sha256"], receipt["helper"]["preflight_screenshot"]: receipt["helper"]["preflight_screenshot_sha256"]}
expected.update({item["image"]: item["sha256"] for item in receipt["visible_gate"]["before"]})
for name, wanted in expected.items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == wanted

for name in ("README.md", "GALLERY.md", "transcript-preflight.json", "transcript-camera-helper.json", "transcript-visible-go-gate.json", "transcript-a-e.json", "transcript-cleanup.json"):
    assert (root / name).is_file()

print("NOT_TESTED is correctly fail-closed before the visible Go gate; credentials and A–E did not run.")
