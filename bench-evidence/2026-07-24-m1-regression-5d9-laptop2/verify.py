#!/usr/bin/env python3
"""Fail closed on identity and honest stop-boundary evidence."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RECEIPT = json.loads((ROOT / "receipt.json").read_text())
REVISION = "5d9fc9ed85b39173b919f8d3c988c5efc1e0f8ef"
INSTALLER_HASH = "433a952f25286b35db84c70258b290bdeac6a07c9187a81baa248401b734c70c"

def need(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")

need(RECEIPT["verdict"] == "PARTIAL", "verdict must be honest PARTIAL")
need(RECEIPT["source"]["revision"] == REVISION, "wrong accepted revision")
need(RECEIPT["legion"]["host"] == "DESKLINK129887", "wrong Legion host")
need(RECEIPT["legion"]["role"] == "exact-package-builder", "wrong Legion role")
need(RECEIPT["laptop2"]["expected_host"] == "DESKLINK00998", "wrong Laptop-2 host")
need(RECEIPT["laptop2"]["role"] == "drive-only installer consumer", "wrong Laptop-2 role")
resource = RECEIPT["legion"]["post_reboot_resources"]
need(resource["available_memory_mb"] >= 12288, "Legion post-reboot memory gate")
need(resource["committed_memory_percent"] <= 85, "Legion committed-memory gate")
need(resource["c_free_gb"] >= 5 and resource["d_free_gb"] >= 500, "Legion disk gate")
need(RECEIPT["legion"]["pre_reboot_system_host_spike"]["absent"], "old system-host spike not cleared")
need(RECEIPT["legion"]["preflight"]["ports"] == {"9223": 0, "9250": 0, "9251": 0}, "Legion ports not clear")
archive = RECEIPT["source"]["archive"]
need(archive["sha256"] == archive["destination_sha256"], "archive transfer hash mismatch")
build = RECEIPT["legion"]["build"]
need(build["one_build_count"] == 1 and build["cargo_started"], "not exactly one Legion build")
need(not build["second_build_ran"], "second build recorded")
need(RECEIPT["laptop2"]["build_count"] == 0, "Laptop-2 build recorded")
need(all(build["flags"].values()), "required build flags were not all enabled")
artifact = RECEIPT["legion"]["artifacts"]["installer"]
need(artifact["sha256"] == INSTALLER_HASH and artifact["bytes"] > 0, "installer identity absent")
need(RECEIPT["legion"]["artifacts"]["executable"]["bytes"] > 0, "executable identity absent")
need(RECEIPT["transfer"]["legion"]["sha256"] == INSTALLER_HASH, "Legion installer hash mismatch")
need(RECEIPT["transfer"]["server_staging"]["sha256"] == INSTALLER_HASH, "server installer hash mismatch")
need(RECEIPT["transfer"]["laptop2"]["status"] == "NOT RUN", "Laptop-2 transfer must be stopped")
need("Laptop-2 SSH treated" in RECEIPT["first_blocker"]["reason"], "missing exact first blocker")
assertions = RECEIPT["m1_assertions"]
need(len(assertions) == 8 and all(item["verdict"] == "NOT RUN" for item in assertions), "later M1 assertions ran after blocker")
need(RECEIPT["screenshots"] == {}, "screenshots cannot exist without a Laptop-2 drive")
safety = RECEIPT["safety"]
need(not safety["whole_firm_enabled"], "Whole Firm must remain closed")
need(all(value for key, value in safety.items() if key != "whole_firm_enabled"), "a no-account/no-provider/no-send safety fact is false")
for filename in ("README.md", "GALLERY.md", "receipt.json"):
    need((ROOT / filename).is_file(), f"missing evidence file {filename}")
print("PASS: exact one-build evidence is bound and the Laptop-2 stop boundary is honest")
