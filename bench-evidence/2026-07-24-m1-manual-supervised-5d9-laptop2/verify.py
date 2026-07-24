#!/usr/bin/env python3
"""Fail-closed verifier for the one blocked manual-supervised Laptop-2 lane."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
RECEIPT = ROOT / "receipt.json"
EXPECTED_REVISION = "5d9fc9ed85b39173b919f8d3c988c5efc1e0f8ef"
EXPECTED_INSTALLER_SHA = "433a952f25286b35db84c70258b290bdeac6a07c9187a81baa248401b734c70c"
EXPECTED_HELPER_SHA = "55261f488a6a7b2cf8607847ac4f7c68b7e6a4584d691c9996df84aefa8fbc01"
REQUIRED_TOKENS = {
    "transcripts/01-server-installer-identity.txt": ["186429197", EXPECTED_INSTALLER_SHA, "Observation: PASS"],
    "transcripts/02-laptop-host.txt": ["Desklink00998", "Observation: PASS"],
    "transcripts/03-laptop-interactive-user.txt": ["desklink00998\\james", "Observation: PASS"],
    "transcripts/04-helper-task-inventory.txt": ["UXEvalAgent", "Interactive only", "C:\\lantern-plus\\scripts\\legion_agent.py"],
    "transcripts/05-helper-script-identity.txt": ["ERROR_FILE_NOT_FOUND", EXPECTED_HELPER_SHA, "Observation: BLOCKED"],
}
NOT_STARTED = [
    "resource_preflight", "fresh_root", "transfer", "laptop_copy_identity",
    "visible_installer", "installed_executable_identity", "helper_listener", "helper_tunnel",
    "helper_health", "helper_size", "helper_pre_input_screenshot", "exact_app_launch",
    "workspace_picker", "sample_hendricks", "today", "crm_hendricks", "meetings_hendricks",
    "ask_hendricks", "whole_firm_closed", "crm_before_close", "normal_close", "exact_app_reopen",
    "hendricks_persists_after_reopen",
]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def require(condition, message):
    if not condition:
        raise AssertionError(message)

def main():
    data = json.loads(RECEIPT.read_text())
    require(data["verdict"] == "UNKNOWN", "verdict must be UNKNOWN")
    require(data["first_blocker"]["code"] == "HELPER_IDENTITY", "first blocker must be HELPER_IDENTITY")
    require(data["authority"]["accepted_revision"] == EXPECTED_REVISION, "accepted revision mismatch")
    require(data["authority"]["remote"] == "https://github.com/lanternplatform/lantern.git", "remote mismatch")
    artifact = data["artifact"]
    require(artifact["server_bytes"] == 186429197, "server installer bytes mismatch")
    require(artifact["server_sha256"] == EXPECTED_INSTALLER_SHA, "server installer SHA mismatch")
    require(data["machine"]["hostname"] == "DESKLINK00998", "host mismatch")
    require(data["machine"]["interactive_user"].lower() == "desklink00998\\james", "user mismatch")
    helper = data["helper"]
    require(helper["expected_sha256"] == EXPECTED_HELPER_SHA, "helper expected SHA mismatch")
    require(helper["action_path"] == r"C:\lantern-plus\scripts\legion_agent.py", "helper action path mismatch")
    require(helper["identity_verdict"] == "BLOCKED", "helper must remain blocked")
    require(helper["observed_hash"] is None, "missing helper must not be given a hash")
    hashes = data["file_hashes"]
    require(set(hashes) == set(REQUIRED_TOKENS), "transcript hash set is incomplete or enlarged")
    for relative, tokens in REQUIRED_TOKENS.items():
        path = ROOT / relative
        require(path.is_file(), f"missing {relative}")
        require(digest(path) == hashes[relative], f"digest mismatch {relative}")
        body = path.read_text()
        for token in tokens:
            require(token in body, f"missing evidence token {token!r} in {relative}")
    require(data["screenshots"] == [], "a blocked-before-helper lane must not claim screenshots")
    observations = {item["id"]: item for item in data["ordered_observations"]}
    for name in NOT_STARTED:
        require(observations.get(name, {}).get("status") == "NOT_STARTED", f"{name} must be NOT_STARTED")
    require(observations["helper_script_identity"]["status"] == "BLOCKED", "helper identity must be blocked")
    safety = data["safety"]
    require(all(value is True for key, value in safety.items() if key != "whole_firm_enabled"), "a forbidden action was recorded")
    require(safety["whole_firm_enabled"] is False, "Whole Firm must remain closed")
    print("PASS: fail-closed UNKNOWN evidence is internally consistent")

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
