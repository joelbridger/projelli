# Worker brief — LOCAL Windows VM on this server (testing-capacity spike, Phase 1 only)

**Lane:** cc-lantern-winvm · dir `~/lantern-plus` (this is an INFRA lane — you write no product code; any files you create live under `/mnt/devcache/winvm/` + this one doc)
**Model:** Sonnet 5 · high.

## Why (context)
Jameson approved exploring a Windows VM running ON this server (64GB, KVM-capable, 1.1T free on /mnt/devcache) as free, always-available Windows test capacity — snapshot-resets, no cloud cost, no physical laptop contention. This is Phase 1: prove the plumbing. Phase 2 (toolchain + building the app + CDP driving) is a LATER lane — do not start it.

## Phase-1 scope (all of this, nothing more)
1. Install virtualization tooling (qemu-kvm/libvirt or plain QEMU — your call; `/dev/kvm` exists, CPU has 40 virt-flagged cores). If `sudo` is refused for installs, STOP and report — do not work around it.
2. Obtain a legitimate free Windows 11 image: Microsoft's "Windows 11 development environment" VM (convert to qcow2 if needed) or an evaluation ISO with an unattended install — pick the fastest RELIABLE path and note the license expiry story in your report.
3. Create the VM on `/mnt/devcache/winvm/` (qcow2). Caps: **12GB RAM max, 8 vCPUs max, 256G disk max.** Before first boot, run it through the `memq` admission queue if that's how launches are gated on this box (see ~/lantern-coordination/MEMORY-GOVERNANCE.md).
4. Inside Windows: enable the built-in OpenSSH Server, set up auto-logon to an interactive desktop session (this matters — WebView2 CDP needs an interactive session; a parallel lane just proved this on Azure), and confirm you can `ssh` into it from this server via its local IP.
5. Snapshot the clean state (qcow2 snapshot or a copy) as `winvm-clean-1`.
6. Write a runbook section (create `coordination/winvm/SETUP-LOG.md`): how to start/stop/reset it, resource caps, license notes, what Phase 2 needs.

## Success bar
`ssh <user>@<vm-ip> "ver"` from this server returns the Windows version, and the clean snapshot exists. Report wall-time and disk/RAM actually used.

## Rules
- Never let the VM eat the box: hard caps above; if host available RAM (free -m, "available") drops under 8G while the fleet is busy, pause the VM and report.
- Long downloads/installs: run inside tmux-safe steps with `timeout`, report progress at each milestone (tooling installed / image obtained / VM boots / SSH works / snapshot done).
- Do not touch the Legion, the Azure VM, any `~/lp-*` worktree, or any cargo target dir. No product-repo commits except `coordination/winvm/SETUP-LOG.md` + this brief's checklist updates (commit those on the `lantern-plus` branch — run `git branch --show-current` first).
- If Windows licensing/downloads make the whole idea impractical, that's a VALID outcome — report it honestly and stop.
- When done: print the runbook summary, then as the very last line of your turn the done sentinel in the standard format for this lane (copy exactly): `WORKER-DONE: winvm-phase1`
