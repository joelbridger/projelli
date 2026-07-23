#!/usr/bin/env python3
"""Fail closed for the one-build R2 evidence record."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RECEIPT = ROOT / "receipt.json"
EXPECTED = {
    "revision": "897640c95d50f14400fe0868904f5da3f11aa9fb",
    "source_tree": "163d6fe1a81941ba3023552130559a5949b95ee6",
    "archive_sha256": "a7e856b35840aa40aa416558ff0d7927e167f94d6313b1464029f7bfdbd796f5",
    "package_json_sha256": "192f9b6e8237344fe730d4dcf058759bd3b0457664501f3fa1f0b351f380e012",
    "tauri_config_sha256": "6d270bb49caebbd0d685efa9ac8ffbb4a74bd1eb8e4da71d9767f0e699772608",
}


def fail(message: str) -> None:
    raise SystemExit(f"FAIL-CLOSED: {message}")


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def main() -> None:
    if not RECEIPT.is_file():
        fail("missing receipt.json")
    data = json.loads(RECEIPT.read_text(encoding="utf-8"))
    binding = data.get("launch_binding", {})
    if binding != {
        "job_id": "20260723-062646-4ds5xxxx",
        "contract_sha256": "43ff9baeca96fd0acef57f33516c79067462e1e70345718d647f812d7bc3b4b4",
        "launch_record": "/home/jameson/.local/share/codex-fleet/20260723-062646-4ds5xxxx/launch-record.json",
        "attempt": 2,
    }:
        fail("launch binding differs")
    if data.get("identity") != {**data.get("identity", {}), **EXPECTED}:
        fail("accepted source identity differs")
    sidecars = data.get("sidecars", {})
    if sidecars.get("source") != "verified hash-keyed local sidecar mirror" or sidecars.get("files_verified") != 446 or sidecars.get("downloads") is not False or sidecars.get("cache_claim") != "none":
        fail("sidecar provenance or no-download claim differs")
    build = data.get("build", {})
    if build.get("count") != 1 or build.get("exit_code") != 1 or build.get("task_final_result") != 1:
        fail("one-build failure receipt differs")
    if build.get("build_log_exists") is not False or build.get("artifacts") != {"executable": None, "installer": None}:
        fail("unexpected artifact/log claim")
    if set(build.get("flags", {})) != {"selection_authority_boot_gate", "meetings_shell_v1", "shared_client_bar", "v1_shell_frame"} or not all(build["flags"].values()):
        fail("V1 flags are incomplete")
    milestones = data.get("milestones", {})
    if [milestones.get(name, {}).get("verdict") for name in ("M2", "M3", "M5")] != ["NOT RUN", "NOT RUN", "NOT RUN"]:
        fail("milestone dependency order is contradictory")
    product = data.get("product", {})
    if product.get("verdict") != "NOT TESTED" or product.get("screenshots") != []:
        fail("product result or screenshot list is contradictory")
    safety = data.get("safety", {})
    for key in ("no_retry", "no_send", "no_approval_write", "no_cloud_egress", "no_stop_scheduled_task", "no_stop_process", "no_task_deletion"):
        if safety.get(key) is not True:
            fail(f"missing safety fact: {key}")
    for filename in ("README.md", "GALLERY.md", "BENCH-TOOLING-DEFECT.md", "stage-pinned-sidecars.ps1", "build-once.ps1"):
        if not (ROOT / filename).is_file():
            fail(f"missing evidence file: {filename}")
    for filename in ("stage-receipt.json", "npm-ci-receipt.json", "prebuild-identity.json", "build-receipt.json", "final-task-state.json"):
        if not (ROOT / "remote-receipts" / filename).is_file():
            fail(f"missing copied machine receipt: {filename}")
    for item in product["screenshots"]:
        path = ROOT / "screenshots" / item["name"]
        if not path.is_file() or digest(path) != item["sha256"]:
            fail(f"screenshot hash mismatch: {item['name']}")
    print("corrective-evidence: OK — one failed pre-compiler invocation; product not tested")


if __name__ == "__main__":
    main()
