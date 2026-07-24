#!/usr/bin/env python3
"""Fail closed verification for the attempt-2 preflight-only evidence."""
from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RECEIPT = json.loads((ROOT / "receipt.json").read_text(encoding="utf-8"))
PREFLIGHT = json.loads((ROOT / "transcripts" / "preflight.json").read_text(encoding="utf-8"))
CLEANUP = json.loads((ROOT / "transcripts" / "cleanup.json").read_text(encoding="utf-8"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def secret_absence() -> None:
    protected = Path("/home/jameson/lantern/coordination/demo-creds/lantern-internal-test-advisor.json")
    require(protected.is_file(), "protected credential file is unavailable for secret scan")
    credentials = json.loads(protected.read_text(encoding="utf-8"))
    values = [value for key, value in credentials.items()
              if key in {"email", "password", "license_key", "org_id", "user_id"} or "token" in key.lower()
              if isinstance(value, str) and value]
    for path in ROOT.rglob("*"):
        if not path.is_file() or path == protected:
            continue
        blob = path.read_bytes()
        for value in values:
            require(value.encode("utf-8") not in blob, f"protected value present in {path.relative_to(ROOT)}")


def main() -> int:
    require(RECEIPT["terminal_product_verdict"] == "NOT_TESTED", "terminal verdict must be NOT_TESTED")
    require(RECEIPT["stop_point"]["reason"] == "NOT_TESTED / ANOTHER ACTIVE LANTERN BENCH OWNER", "wrong stop reason")
    require(RECEIPT["contract"]["sha256"] == "90ba771be8a4bd4896de848fae767add297afd4ac6ee3eba26323dde3193a27d", "wrong launch contract")
    require(RECEIPT["source"]["worktree_revision_before_evidence"] == "5d9fc9ed85b39173b919f8d3c988c5efc1e0f8ef", "wrong source revision")
    require(RECEIPT["source"]["fresh_root"] == r"C:\Lantern-M2-5d9-PRIVATE-20260724-02", "wrong fresh root identity")
    require(RECEIPT["bench"]["keepance_dev"] == {"state": "Ready", "read_only_observation": True, "running": False}, "KeepanceDev was not read-only observed non-running")
    require(RECEIPT["bench"]["lantern_processes"] == {"count": 0, "competing_lantern_present": False}, "competing lantern process assertion missing")
    require(PREFLIGHT["desktop_owner_check"]["result"] == "ambiguous" and PREFLIGHT["desktop_owner_check"]["stop"], "desktop owner ambiguity not recorded")
    require(PREFLIGHT["actions_after_stop"] == {"helper_request": False, "fresh_root_checked": False, "fresh_root_created": False, "credentials_read_or_transferred": False, "app_launched": False, "pointer_or_keyboard_input": False}, "forbidden action followed stop")
    require(RECEIPT["helper"]["expected_action_execute"] == r"C:\Users\james\AppData\Local\Programs\Python\Python312\pythonw.exe", "helper pin missing")
    require(RECEIPT["helper"]["expected_action_arguments"] == r"C:\agent\legion_agent.py", "helper script pin missing")
    require(RECEIPT["helper"]["expected_script_sha256"] == "55261f488a6a7b2cf8607847ac4f7c68b7e6a4584d691c9996df84aefa8fbc01", "helper hash pin missing")
    require(all(item["status"] == "NOT_RUN" for item in RECEIPT["ordered_assertions"]), "A-E must not run after ownership stop")
    safety = RECEIPT["safety"]
    require(all(safety[key] is True for key in ("no_build", "no_install", "no_send", "no_provider", "no_m3", "no_seat_or_staff_action", "whole_firm_closed", "app_not_launched_by_lane", "no_pointer_or_keyboard_input", "credential_not_used")), "safety boundary incomplete")
    require(CLEANUP["non_gating"] is True and CLEANUP["changes_product_verdict"] is False, "cleanup must remain non-gating")
    require(len(CLEANUP["steps"]) == 6, "every cleanup category must be recorded")
    secret_absence()
    print("PASS: fail-closed ownership-stop evidence verified")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
