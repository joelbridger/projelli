#!/usr/bin/env python3
"""Fail closed on attempt-2 lineage, transport, identity, and stop boundary."""
import base64
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TRANSCRIPTS = ROOT / "transcripts"
RECEIPT = json.loads((ROOT / "receipt.json").read_text(encoding="utf-8"))

ATTEMPT_1_COMMIT = "43cf12c83e28da4ede5a2aa6f57246f2ab2f3b7e"
REVISION = "5d9fc9ed85b39173b919f8d3c988c5efc1e0f8ef"
INSTALLER_BYTES = 186429197
INSTALLER_HASH = "433a952f25286b35db84c70258b290bdeac6a07c9187a81baa248401b734c70c"
EXECUTABLE_BYTES = 215660032
EXECUTABLE_HASH = "62d3bf454bb84fa1799856719c1bf7e4f0248802d72832cd36c98b030e99c2e8"


def need(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def transcript(name):
    path = TRANSCRIPTS / name
    need(path.is_file(), f"missing transcript {name}")
    expected = RECEIPT["transcripts"].get(name)
    need(expected is not None, f"receipt does not bind {name}")
    need(sha256(path) == expected, f"transcript hash mismatch: {name}")
    return path.read_text(encoding="utf-8")


need(RECEIPT["attempt"] == 2 and RECEIPT["max_attempts"] == 2, "must be ordinary attempt 2 of 2")
need(RECEIPT["verdict"] == "PARTIAL", "transport blocker must be PARTIAL")
need(RECEIPT["product_journey"] == "NOT RUN", "product journey must not run")
need(RECEIPT["first_blocker"]["class"] == "BENCH_TOOLING", "wrong first-blocker class")
need(not RECEIPT["first_blocker"]["product_tested"], "product must not be treated as tested")
need(RECEIPT["source"]["accepted_product_revision"] == REVISION, "wrong accepted app revision")
need(RECEIPT["source"]["attempt_2_base_revision"] == REVISION, "wrong attempt-2 base revision")
need(RECEIPT["contract"]["sha256"] == "308fe731d5b8a7f3833d9d8a8a73341cf3dec6b56252f7e6d0cb83bd1ea9aee6", "wrong contract")
lineage = RECEIPT["attempt_lineage"]
need(lineage["attempt_1_job"] == "20260724-012434-4walxxxx", "wrong attempt-1 job")
need(lineage["attempt_1_evidence_commit"] == ATTEMPT_1_COMMIT, "wrong attempt-1 commit")
need("One remote cmd.exe invocation did run" in lineage["attempt_1_wording_correction"], "attempt-1 correction absent")

previous = subprocess.run(
    ["git", "show", f"{ATTEMPT_1_COMMIT}:bench-evidence/2026-07-24-m1-regression-5d9-laptop2/receipt.json"],
    cwd=ROOT,
    text=True,
    capture_output=True,
)
need(previous.returncode == 0, "accepted attempt-1 receipt is unavailable at its exact commit")
previous_receipt = json.loads(previous.stdout)
need(previous_receipt["attempt"] == 1 and previous_receipt["verdict"] == "PARTIAL", "attempt-1 receipt is not accepted partial lineage")
need(previous_receipt["source"]["revision"] == REVISION, "attempt-1 binds the wrong revision")
need(previous_receipt["legion"]["artifacts"]["installer"]["bytes"] == INSTALLER_BYTES, "attempt-1 installer bytes mismatch")
need(previous_receipt["legion"]["artifacts"]["installer"]["sha256"] == INSTALLER_HASH, "attempt-1 installer hash mismatch")

artifact = RECEIPT["artifact"]
for item in (artifact["installer"], artifact["attempt_1_receipt"]):
    need(item["installer_bytes"] == INSTALLER_BYTES if "installer_bytes" in item else item["bytes"] == INSTALLER_BYTES, "installer byte identity mismatch")
    need(item["installer_sha256"] == INSTALLER_HASH if "installer_sha256" in item else item["sha256"] == INSTALLER_HASH, "installer hash identity mismatch")
need(artifact["executable"]["bytes"] == EXECUTABLE_BYTES, "executable byte identity mismatch")
need(artifact["executable"]["sha256"] == EXECUTABLE_HASH, "executable hash identity mismatch")
need(artifact["attempt_1_receipt"]["executable_bytes"] == EXECUTABLE_BYTES, "attempt-1 executable bytes mismatch")
need(artifact["attempt_1_receipt"]["executable_sha256"] == EXECUTABLE_HASH, "attempt-1 executable hash mismatch")
need(artifact["server_staging"]["bytes"] == INSTALLER_BYTES, "server staging bytes mismatch")
need(artifact["server_staging"]["sha256"] == INSTALLER_HASH, "server staging hash mismatch")
need(artifact["laptop2_destination"]["status"] == "NOT RUN", "Laptop-2 destination must not exist after first blocker")

server = transcript("00-server-installer-identity.txt")
need(f"STAGE bytes={INSTALLER_BYTES}" in server and INSTALLER_HASH in server, "server transcript lacks exact installer identity")
host = transcript("01-harmless-cmd-host-probe.txt")
need("exact_command: ssh -o BatchMode=yes -o ConnectTimeout=10 james@100.64.136.15 'cmd.exe /d /s /c \"echo HOST=%COMPUTERNAME%&&whoami\"'" in host, "host probe shape changed")
need("exit_code: 0" in host and "HOST=DESKLINK00998" in host and "desklink00998\\james" in host, "host probe did not prove expected host and user")

machine = RECEIPT["machine"]
need(machine["expected_host"] == "DESKLINK00998", "wrong expected host")
need(machine["host_probe_host"] == "DESKLINK00998", "wrong observed host")
need(machine["host_probe_user"].lower().endswith("\\james"), "host probe user is not james")
transport = RECEIPT["transport"]
need(transport["cmd_host_probe_count"] == 1, "exactly one harmless cmd host probe is required")
need(transport["encoded_powershell_operation_count"] == 1, "exactly one encoded PowerShell operation is required")
need(transport["raw_powershell_operations"] == 0 and transport["other_remote_command_shapes"] == 0, "forbidden remote command transport recorded")
preflight_script = TRANSCRIPTS / "02-encoded-preflight-script.ps1.txt"
preflight_text = preflight_script.read_text(encoding="utf-8")
preflight = transport["preflight"]
need(hashlib.sha256(preflight_script.read_bytes()).hexdigest() == preflight["plain_utf8_sha256"], "plain script hash mismatch")
utf16 = preflight_text.encode("utf-16le")
need(hashlib.sha256(utf16).hexdigest() == preflight["utf16le_sha256"], "UTF-16LE script hash mismatch")
need(len(base64.b64encode(utf16)) == preflight["base64_characters"], "Base64 payload length mismatch")
need(preflight["remote_exit_code"] == 1 and not preflight["executed"], "failed payload must not be presented as executed")
encoded = transcript("02-encoded-preflight.txt")
need("powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand" in encoded, "encoded PowerShell transport missing")
need("The command line is too long." in encoded, "actual transport rejection token missing")
need("remote_stdout:\n\nremote_stderr:" in encoded, "preflight stdout/stderr boundary missing")

for name in (
    "03-laptop2-installer-identity-not-run.txt",
    "04-installed-executable-identity-not-run.txt",
    "05-initial-app-process-not-run.txt",
    "06-normal-close-not-run.txt",
    "07-reopened-app-process-not-run.txt",
):
    need("status: NOT RUN" in transcript(name), f"{name} does not preserve the stop boundary")

actual_transcripts = {path.name for path in TRANSCRIPTS.iterdir() if path.is_file()}
need(actual_transcripts == set(RECEIPT["transcripts"]), "receipt transcript inventory differs from disk")
screens = ROOT / "screenshots"
actual_screens = set() if not screens.exists() else {path.name for path in screens.iterdir() if path.is_file()}
need(actual_screens == set(RECEIPT["screenshots"]), "screenshot inventory differs from receipt")
need(not actual_screens, "screenshots cannot exist before a safe desktop drive")

need(RECEIPT["preflight"]["status"] == "NOT RUN", "preflight must not be marked passed")
need(RECEIPT["lane_root"]["status"] == "NOT CREATED", "lane root must not be created")
need(RECEIPT["install"]["status"] == "NOT RUN", "installation must not run")
need(all(value == "NOT RUN" for value in RECEIPT["processes"].values()), "process proof must not run")
need(RECEIPT["workspace"]["status"] == "NOT RUN", "workspace must not run")
assertions = RECEIPT["m1_assertions"]
need(len(assertions) == 8 and all(item["verdict"] == "NOT RUN" for item in assertions), "all ordered M1 assertions must stop")
safety = RECEIPT["safety"]
need(not safety["whole_firm_enabled"], "Whole Firm must remain closed")
need(all(value for key, value in safety.items() if key != "whole_firm_enabled"), "a required no-action safety fact is false")
readme = (ROOT / "README.md").read_text(encoding="utf-8")
need("BENCH TOOLING / PRODUCT NOT TESTED" in readme, "README lacks bench/product distinction")
need("before any Laptop-2 command ran" not in readme, "README repeats corrected wording error")

print("PASS: exact partial lineage and server artifact are bound; Laptop-2 transport stopped before product testing")
