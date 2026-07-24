#!/usr/bin/env python3
"""Fail-closed verifier for the stopped M2 Legion privacy proof."""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXPECTED_REVISION = "5d9fc9ed85b39173b919f8d3c988c5efc1e0f8ef"
EXPECTED_EXE_HASH = "62d3bf454bb84fa1799856719c1bf7e4f0248802d72832cd36c98b030e99c2e8"
EXPECTED_HELPER_HASH = "55261f488a6a7b2cf8607847ac4f7c68b7e6a4584d691c9996df84aefa8fbc01"
EXPECTED_SCREENSHOT_HASH = "a03cf105b6107a4dfc890b713b2155f04d3b5da87349b1724baa5a0f04d984f0"


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


def require(value: bool, message: str) -> None:
    if not value:
        fail(message)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def protected_values() -> list[str]:
    """Read only to prevent raw values entering evidence; never print them."""
    cred = Path("/home/jameson/lantern/coordination/demo-creds/lantern-internal-test-advisor.json")
    try:
        raw = json.loads(cred.read_text(encoding="utf-8"))
    except Exception:
        return []
    values: list[str] = []
    for key in ("email", "password", "license_key", "org_id", "user_id"):
        value = raw.get(key)
        if isinstance(value, str) and value:
            values.append(value)
    for key, value in raw.items():
        if "token" in key.lower() and isinstance(value, str) and value:
            values.append(value)
    return values


def main() -> None:
    receipt = json.loads((ROOT / "receipt.json").read_text(encoding="utf-8"))
    require(receipt.get("schema_version") == 1, "schema version")
    require(receipt.get("terminal_product_verdict") == "NOT_TESTED", "terminal verdict")
    stop = receipt.get("stop_point", {})
    require(stop.get("reason") == "NOT_TESTED / ANOTHER ACTIVE LANTERN BENCH OWNER", "first blocker")
    require(stop.get("later_product_steps_not_run") is True, "stop boundary")
    source = receipt.get("source", {})
    require(source.get("worktree_revision_before_evidence") == EXPECTED_REVISION, "accepted revision")
    require(source.get("worktree_clean_before_evidence") is True, "clean initial worktree")
    require(source.get("fresh_root_absent_before_creation") is True and source.get("fresh_root_created") is False, "fresh root")
    exe = receipt.get("exact_executable", {})
    require(exe.get("sha256") == EXPECTED_EXE_HASH and exe.get("bytes") == 215660032, "exact executable")
    require(exe.get("launch_attempted") is False, "no app launch")
    helper = receipt.get("helper", {})
    require(helper.get("task") == "LegionAgent", "helper task")
    require(helper.get("action_execute") == r"C:\Users\james\AppData\Local\Programs\Python\Python312\pythonw.exe", "helper action executable")
    require(helper.get("action_arguments") == r"C:\agent\legion_agent.py", "helper action argument")
    require(helper.get("script_sha256") == EXPECTED_HELPER_HASH, "helper bytes")
    fresh = helper.get("fresh_helper", {})
    listener = fresh.get("listener", {})
    require(fresh.get("new_pid_verified") is True and fresh.get("session") == 1, "new interactive helper")
    require(listener == {"address": "127.0.0.1", "port": 8765, "pid": 128100, "sole_listener": True}, "helper localhost listener")
    tunnel = helper.get("fresh_tunnel", {})
    require(tunnel.get("server_listener") == "127.0.0.1:18765", "server loopback tunnel")
    require(tunnel.get("only_destination") == "Legion 127.0.0.1:8765" and tunnel.get("all_helper_requests_used_tunnel") is True, "tunnel destination")
    require(tunnel.get("closed") is True, "tunnel cleanup observation")
    shot = ROOT / "screenshots" / "00-helper-preflight.png"
    require(shot.is_file() and digest(shot) == EXPECTED_SCREENSHOT_HASH, "screenshot hash")
    require(all((ROOT / item).is_file() for item in receipt.get("transcripts", [])), "transcript existence")
    workspace = receipt.get("synthetic_workspace", {})
    require(workspace.get("synthetic_hendricks_summary_marker_found") is True, "synthetic Hendricks source")
    require(workspace.get("non_synthetic_client_workspace_found") is False and workspace.get("copy_attempted") is False, "workspace boundary")
    credentials = receipt.get("network_and_credentials", {})
    require(credentials.get("temporary_windows_credential_file", {}).get("acl") == "not_created_before_stop", "credential ACL stop boundary")
    assertions = receipt.get("ordered_assertions", [])
    require([item.get("id", "")[:1] for item in assertions] == list("ABCDE"), "A-E order")
    require(all(item.get("status") == "NOT_RUN" for item in assertions), "no action after stop")
    safety = receipt.get("safety", {})
    for field in ("no_build", "no_install", "no_send", "no_provider", "no_m3", "no_seat_or_staff_action", "whole_firm_closed", "app_not_launched_by_lane", "credential_not_used"):
        require(safety.get(field) is True, f"safety {field}")
    cleanup = receipt.get("cleanup", {})
    require(cleanup.get("status") == "completed_best_effort" and cleanup.get("changes_product_verdict") is False, "cleanup record")
    for secret in protected_values():
        for path in ROOT.rglob("*"):
            if path.is_file() and secret.encode("utf-8") in path.read_bytes():
                fail("raw protected credential value found in evidence")
    changed = subprocess.check_output(["git", "diff", "--name-only", EXPECTED_REVISION + "..HEAD"], text=True).splitlines()
    allowed = "bench-evidence/2026-07-24-m2-private-note-legion-5d9/"
    require(changed and all(item.startswith(allowed) for item in changed), "only contract-owned evidence changed")
    print("OK: stopped M2 evidence is internally consistent and secret-safe")


if __name__ == "__main__":
    main()
