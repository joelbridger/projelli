#!/usr/bin/env python3
"""Fail-closed verifier for this M2 camera-observer ownership-stop evidence."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RECEIPT = json.loads((ROOT / "receipt.json").read_text(encoding="utf-8"))
PREFLIGHT = json.loads((ROOT / "transcripts" / "preflight.json").read_text(encoding="utf-8"))
CLEANUP = json.loads((ROOT / "transcripts" / "cleanup.json").read_text(encoding="utf-8"))
CONTRACT_SHA = "6d6429100eb20f7b59c01b49d18fe1f191d61fc9a92cca6c37d3c42327f5229b"
APP_SHA = "62d3bf454bb84fa1799856719c1bf7e4f0248802d72832cd36c98b030e99c2e8"
CAMERA_SHA = "026811c25cff6e5f211195369e7617b3f4b8b7bf222adb83e47e0ef84e35509f"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def secret_absence() -> None:
    protected = Path("/home/jameson/lantern/coordination/demo-creds/lantern-internal-test-advisor.json")
    require(protected.is_file(), "protected credential file unavailable for secret scan")
    credentials = json.loads(protected.read_text(encoding="utf-8"))
    values = [value for value in credentials.values() if isinstance(value, str) and value]
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        blob = path.read_bytes()
        for value in values:
            require(value.encode("utf-8") not in blob, f"protected value present in {path.relative_to(ROOT)}")


def main() -> int:
    require(RECEIPT["contract"]["sha256"] == CONTRACT_SHA, "wrong launch contract")
    require(RECEIPT["source"]["worktree_revision_before_evidence"] == "5d9fc9ed85b39173b919f8d3c988c5efc1e0f8ef", "wrong source revision")
    require(RECEIPT["source"]["fresh_root"] == r"C:\Lantern-M2-5d9-PRIVATE-20260724-03", "wrong fresh root")
    require(RECEIPT["exact_executable"]["sha256"] == APP_SHA and RECEIPT["exact_executable"]["bytes"] == 215660032, "exact app pin missing")

    camera = RECEIPT["camera"]
    require(camera["present_tense_proven"] is True, "camera classification missing")
    require(camera["task"] == "BenchCam", "wrong camera task")
    require(camera["action_execute"] == r"C:\Users\james\AppData\Local\Programs\Python\Python312\pythonw.exe", "wrong camera executable")
    require(camera["sole_argument"] == r"C:\Users\james\bench_cam.py", "wrong camera argument")
    require(camera["script_sha256"] == CAMERA_SHA, "wrong camera script hash")
    require(camera["sole_listener"] == "127.0.0.1:8799", "camera listener not pinned")
    require(camera["source_passive_only"] and camera["control_endpoint_refusals"], "camera not proven passive")
    frame = ROOT / camera["fresh_frame"]
    require(frame.is_file() and sha256(frame) == camera["fresh_frame_sha256"], "camera frame absent or hash mismatch")
    require(PREFLIGHT["camera"]["classification"] == "APPROVED_READ_ONLY_OBSERVER", "camera observer exception not classified")
    require(all(status == 501 for status in PREFLIGHT["camera"]["endpoint_refusals"]["non_read_methods_on_passive_paths"].values()), "non-read passive-path refusal missing")
    require(all(status == 404 for status in PREFLIGHT["camera"]["endpoint_refusals"]["control_paths_get"].values()), "control endpoint refusal missing")

    owner = PREFLIGHT["unapproved_interactive_owner"]
    require(owner["process"] == "InputDirectorSessionHelper.exe" and owner["session"] == 1, "unapproved input owner missing")
    require(PREFLIGHT["process_scan"]["other_unapproved_owner_found"] is True, "ownership gate not fail-closed")
    require(RECEIPT["terminal_product_verdict"] == "NOT_TESTED", "a product verdict is dishonest after ownership stop")
    require(RECEIPT["stop_point"]["reason"] == "NOT_TESTED / ANOTHER ACTIVE LANTERN BENCH OWNER", "wrong stop reason")
    require(RECEIPT["mandatory_visible_gate"]["status"] == "NOT_RUN", "visible gate cannot be inferred")
    require(RECEIPT["network_and_credentials"]["credential_contents_read"] is False and RECEIPT["network_and_credentials"]["credential_transferred"] is False, "credentials followed ownership stop")
    require(PREFLIGHT["actions_after_stop"] == {"fresh_root_checked": False, "fresh_root_created": False, "credential_file_content_read": False, "credential_transferred": False, "api_checked": False, "legion_agent_request_or_input": False, "app_launched": False, "workspace_cloned": False, "product_assertions_A_through_E": False}, "forbidden action occurred after stop")
    require(all(item["status"] == "NOT_RUN" for item in RECEIPT["ordered_assertions"]), "A-E must not run")
    safety = RECEIPT["safety"]
    require(all(safety[name] is True for name in ("no_build", "no_install", "no_send", "no_provider", "no_m3", "no_seat_or_staff_action", "whole_firm_closed", "app_not_launched_by_lane", "no_pointer_or_keyboard_input", "credential_not_used")), "safety boundary incomplete")
    require(CLEANUP["non_gating"] is True and CLEANUP["changes_product_verdict"] is False, "cleanup must be non-gating")
    require(any(step["item"] == "camera-only_ssh_tunnel" and step["status"] == "closed" for step in CLEANUP["steps"]), "camera tunnel closure missing")
    secret_absence()
    print("PASS: camera exception proven; unapproved interactive owner correctly stopped product drive")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
