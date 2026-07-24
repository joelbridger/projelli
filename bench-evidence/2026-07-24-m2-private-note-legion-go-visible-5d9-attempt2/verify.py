#!/usr/bin/env python3
"""Fail-closed verifier for the honest Route-B control stop.

It accepts no product PASS.  A future complete Route B would require paired
regular-shell evidence and an active isolated workspace, but never onboarding,
scrolling, or Go.  This receipt records the allowed earlier NOT_TESTED stop.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RECEIPT = json.loads((ROOT / "receipt.json").read_text(encoding="utf-8"))


def sha256(name: str) -> str:
    return hashlib.sha256((ROOT / name).read_bytes()).hexdigest()


def require(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def complete_route_b(route: dict) -> bool:
    """Route B is deliberately independent of onboarding and Go."""
    frames = route["entry_frames"]
    return (
        len(frames) == 2
        and {frame["role"] for frame in frames} == {"helper", "camera"}
        and all(frame["state"] == "regular_shell" for frame in frames)
        and route["paired_views_agree"] is True
        and route["isolated_workspace_active"] is True
        and route["onboarding_forced"] is False
        and route["go_sought_or_pressed"] is False
    )


require(RECEIPT["attempt"] == 2 and RECEIPT["attempt_limit"] == 2, "wrong attempt identity")
require(RECEIPT["source"]["fresh_root"].endswith("-06"), "wrong fresh root")
require(RECEIPT["source"]["fresh_root_absent_before_creation"], "fresh root was not absent")
require(RECEIPT["exact_executable"]["bytes"] == 215660032, "wrong executable size")
require(RECEIPT["exact_executable"]["sha256"] == "62d3bf454bb84fa1799856719c1bf7e4f0248802d72832cd36c98b030e99c2e8", "wrong executable hash")
require(RECEIPT["ownership"]["lantern_before_launch_count"] == 0, "pre-existing Lantern")
require(RECEIPT["ownership"]["input_director_count"] == 0, "Input Director owner present")
require(not RECEIPT["ownership"]["ambiguous_owner"], "ambiguous bench owner")
require(RECEIPT["camera"]["passive_only"], "camera is not passive")
require(RECEIPT["helper"]["fresh_pid"] != RECEIPT["helper"]["previous_pid"], "helper was not fresh")
require(RECEIPT["synthetic_workspace"]["identical"], "synthetic clone mismatch")
require(RECEIPT["network_and_credentials"]["server_credential_file_owner_only"], "credential file permissions")

for name, expected in {
    "00-camera-preflight.jpg": RECEIPT["camera"]["fresh_frame_sha256"],
    "01-helper-preflight.png": "d7f581a9d3603a605eb2efbc84c5eed0b0f49ca5fd5e58b60b5fad7f09056641",
    "02-helper-entry.png": RECEIPT["route_b"]["entry_frames"][0]["sha256"],
    "03-camera-entry.jpg": RECEIPT["route_b"]["entry_frames"][1]["sha256"],
}.items():
    require((ROOT / name).is_file() and sha256(name) == expected, f"bad evidence frame: {name}")

route = RECEIPT["route_b"]
require(RECEIPT["entry_route"] == "regular_shell_already_visible", "mixed or invented route")
require(route["paired_views_agree"], "paired Route-B frames disagree")
require(not route["onboarding_forced"] and not route["go_sought_or_pressed"], "Route B forced onboarding")
require(route["complete_route_b_requires_no_onboarding_scroll_or_go"], "Route-B rule weakened")
require(not complete_route_b(route), "receipt dishonestly calls incomplete Route B complete")
require(route["isolated_workspace_active"] is False, "workspace binding claim is dishonest")
require(route["shared_gate_complete"] is False, "shared gate claim is dishonest")

credentials = RECEIPT["network_and_credentials"]
require(all(credentials[key] is False for key in ("credential_contents_read", "credential_transferred", "clipboard_credential", "credential_typed")), "credential used before gate")
require(RECEIPT["terminal_product_verdict"] == "NOT_TESTED", "dishonest product verdict")
require(RECEIPT["stop_point"]["reason"] == "NOT_TESTED / ORDINARY APP SHELL DRIVE NOT PROVEN", "wrong stop")
require(all(item["status"] == "NOT_RUN" for item in RECEIPT["a_to_e"]), "A-E ran after gate failure")
require(RECEIPT["cleanup"]["changes_product_verdict"] is False, "cleanup changed verdict")

secret_markers = (
    b"BEGIN " + b"PRIVATE KEY",
    b"A" + b"KIA",
    b"AI" + b"za",
    b"xox" + b"b-",
)
for path in ROOT.iterdir():
    if path.is_file() and path.suffix.lower() in {".json", ".md", ".py", ".txt"}:
        contents = path.read_bytes()
        require(not any(marker in contents for marker in secret_markers), f"secret marker in {path.name}")

print("verified: honest NOT_TESTED Route-B workspace-binding stop; no credentials or A-E")
