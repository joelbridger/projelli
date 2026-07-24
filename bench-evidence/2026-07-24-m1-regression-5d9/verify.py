#!/usr/bin/env python3
"""Fail closed for the resource-blocked M1 regression evidence."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RECEIPT = ROOT / "receipt.json"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"evidence verification failed: {message}")


data = json.loads(RECEIPT.read_text(encoding="utf-8"))
require(data["schema_version"] == 1, "unexpected schema")
require(data["lane"] == "phase1-m1-regression-legion-5d9", "wrong lane")
require(data["attempt"] == 2, "wrong attempt")
require(data["verdict"] == "NOT RUN", "product verdict must be NOT RUN")
require(data["contract"]["sha256"] == "356cab75fb4f33cdc5e0c2c11a2cdb61c26b949be1b65304516c56e0a6c8e31b", "wrong contract")
require(data["contract"]["base_revision"] == "5d9fc9ed85b39173b919f8d3c988c5efc1e0f8ef", "wrong accepted revision")
require(data["machine"]["host"] == "DESKLINK129887", "wrong machine")
resources = data["resources"]
require(resources["verdict"] == "FAIL", "resource blocker must be recorded")
require(resources["pre"]["c_free_gb"] == 5.55, "wrong C free space")
require(resources["pre"]["d_free_gb"] == 629.58, "wrong D free space")
require(resources["pre"]["available_memory_mb"] == 4760, "wrong available memory")
require(resources["pre"]["committed_memory_percent"] == 99.19, "wrong committed memory")
require(data["build"]["one_build_count"] == 0, "a build must not be claimed")
require(data["build"]["cargo_or_rust_started"] is False, "Cargo/Rust must not be claimed")
require(data["source"]["local_archive_sha256"] is None, "archive hash must be absent")
require(data["desktop_drive"]["screenshots"] == {}, "no screenshots may be claimed")
for assertion in data["desktop_drive"]["assertions"]:
    require(assertion["verdict"] == "NOT RUN", f"{assertion['id']} must be NOT RUN")
for key, value in data["safety"].items():
    require(value is True or (key == "whole_firm_enabled" and value is False), f"safety fact failed: {key}")
require(data["attempt_lineage"]["attempt_1_product_tested"] is False, "attempt 1 must remain untested")
require(data["attempt_lineage"]["attempt_2_product_tested"] is False, "attempt 2 must remain untested")
for name in ("README.md", "GALLERY.md", "receipt.json"):
    require((ROOT / name).is_file(), f"missing {name}")
print("PASS: resource-blocked evidence is internally consistent")
