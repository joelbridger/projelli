#!/usr/bin/env python3
"""Fail-closed verifier for the machine-bound Legion evidence receipt."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent
EXPECTED_REVISION = "f990b5647784bc3c31fa716a56fa760de845ee2c"


def fail(message: str) -> None:
    raise ValueError(message)


def need(mapping: dict, key: str):
    if key not in mapping:
        fail(f"missing required field: {key}")
    return mapping[key]


def main() -> int:
    try:
        receipt = json.loads((ROOT / "receipt.json").read_text(encoding="utf-8"))
        if need(need(receipt, "source"), "revision") != EXPECTED_REVISION:
            fail("receipt is not for the exact required revision")
        if need(need(receipt, "build"), "one_build_count") != 1:
            fail("one_build_count must be exactly one")
        if receipt["build"].get("second_build_ran") is not False:
            fail("second_build_ran must be false")
        if receipt["build"].get("missing_updater_signing_key") and receipt["build"].get("release_verdict") == "PASS":
            fail("missing signing key cannot have a release PASS")

        milestones = need(receipt, "milestones")
        m2 = need(milestones, "M2")["verdict"]
        m3 = need(milestones, "M3")["verdict"]
        m5 = need(milestones, "M5")["verdict"]
        if m3 == "PASS" and m2 != "PASS":
            fail("M3 PASS requires M2 PASS")
        if m5 == "PASS" and m3 != "PASS":
            fail("M5 PASS requires M3 PASS")
        if m2 != "PASS" and m3 != "NOT_RUN":
            fail("M3 must be NOT_RUN after a non-PASS M2")
        if m3 != "PASS" and m5 != "NOT_RUN":
            fail("M5 must be NOT_RUN after a non-PASS M3")

        stop = need(receipt, "stop_point")
        if stop.get("milestone") == "M2":
            if m3 != "NOT_RUN" or m5 != "NOT_RUN" or stop.get("later_milestones_attempted") is not False:
                fail("a M2 stop point cannot have later milestone activity")
        safety = need(receipt, "safety")
        if m2 != "PASS" and safety.get("no_review_or_approval_write") is not True:
            fail("non-PASS M2 must not claim an approval write")
        if safety.get("no_retry_after_marker") is not True:
            fail("the receipt must affirm no retry after the build marker")

        screenshots = need(receipt, "screenshots")
        if not screenshots:
            fail("at least one screenshot is required")
        for name, expected in screenshots.items():
            if Path(name).name != name:
                fail(f"invalid screenshot name: {name}")
            image = ROOT / "screenshots" / name
            if not image.is_file():
                fail(f"missing screenshot: {name}")
            actual = hashlib.sha256(image.read_bytes()).hexdigest()
            if actual != expected:
                fail(f"screenshot hash mismatch: {name}")

        m2_assertions = need(need(milestones, "M2"), "assertions")
        required = {"M2.1", "M2.2", "M2.3", "M2.4", "M2.5"}
        if {item.get("id") for item in m2_assertions} != required:
            fail("all five M2 assertions are required")
    except (OSError, json.JSONDecodeError, ValueError, TypeError, KeyError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print("PASS: receipt structure, milestone order, and screenshot hashes are valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
