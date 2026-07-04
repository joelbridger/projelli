# Local Windows VM — Phase 1 setup log (testing-capacity spike)

**Status: BLOCKED WITH FINDINGS (Phase 1 not completed — reported per the
brief's explicit "impractical is a valid outcome" clause, on coordinator
direction after a bounded time budget).** All plumbing up to and including
the hardest technical obstacle (the ISO's boot-prompt race) is built and
verified working. The unattended Windows install itself never visibly
progressed past the initial WinPE-loading stage in ~50 minutes of combined
observation across two independent attempts:

- **Attempt 1** (qxl display, default virt-install Hyper-V enlightenments):
  ran ~44 minutes. Continuous, real CPU activity the entire time (confirmed
  via climbing `virsh dominfo` CPU-time counter — not a hang/freeze), but
  the qcow2 disk never grew past its initial ~330KB (partitioning never
  started) and the display cycled between the same handful of frames (OVMF
  splash+spinner, blank at two different resolutions) without ever reaching
  a screen identifiable as Setup's GUI. One *earlier*, separate attempt with
  this same config did briefly show the WinPE `winpeshl.exe` console window
  — proving this exact path *can* reach WinPE — but that milestone did not
  reproduce in the 44-minute attempt.
- **Attempt 2** (same, but with Hyper-V enlightenments — `hv-relaxed`,
  `hv-vapic`, `hv-spinlocks`, `hypervclock` — removed from the domain XML,
  as the one alternative config tried per coordinator direction): ran ~6
  minutes before the decision to stop; produced **identical** behavior —
  same cycling frames, same zero disk growth, same steady CPU burn. This
  rules out Hyper-V enlightenments as the cause.

**Conclusion:** the plumbing (tooling, image, VM, boot-race fix) is sound and
reusable, but something about this unattended Win11 25H2 install is either
(a) far slower on this shared host than a normal install (swtpm + Secure
Boot measured-boot overhead, or host contention from other concurrent
fleet workers), or (b) stalling for a reason not yet isolated — and
distinguishing those two needs more time than was budgeted for this spike.
See "Known issues" item 7 for the next diagnostic steps (tight BSOD-catching
poll, or a from-scratch attempt on a quiet host) for whoever picks this back
up. **Success bar (SSH + clean snapshot) not met.** The VM has been left
running (not destroyed) in case it eventually completes unattended; host
RAM headroom is fine (39GB available, well above the pause threshold) so
leaving it running costs nothing.

## What this is

A local Windows 11 VM running directly on this server (KVM/QEMU + libvirt), managed
outside any product repo, for free always-available Windows test capacity —
snapshot-resettable, no cloud cost, no physical laptop contention. This is Phase 1:
prove the plumbing (VM boots, SSH works, clean snapshot exists). Phase 2 (installing
the dev toolchain, building Keepance, driving it via CDP) is a separate, later lane.

## Where everything lives

| Item | Path |
|---|---|
| Disk images (qcow2, OVMF vars) | `/mnt/devcache/winvm/disk/` |
| Windows ISO (patched, no-prompt boot) | `/mnt/devcache/winvm/iso/win11ent-25h2-noprompt.iso` |
| Original untouched ISO | `/mnt/devcache/winvm/iso/win11ent-25h2-en-us.iso` |
| Unattend answer file + generated media | `/mnt/devcache/winvm/unattend/` |
| Local admin credentials | `/mnt/devcache/winvm/unattend/CREDENTIALS.txt` (mode 600, not in git) |
| libvirt domain name | `winvm-lp` |
| This runbook | `coordination/winvm/SETUP-LOG.md` |

## Resource caps (per brief)

- RAM: 12 GB (`--memory 12288`)
- vCPUs: 8
- Disk: 80 GB qcow2 (sparse; well under the 256G cap)

## How to start / stop / reset

```bash
# Status
sudo virsh domstate winvm-lp
sudo virsh dominfo winvm-lp        # includes CPU time, memory

# Start / graceful stop / force stop
sudo virsh start winvm-lp
sudo virsh shutdown winvm-lp       # graceful (ACPI) — only works once Windows is installed
sudo virsh destroy winvm-lp        # hard power-off, safe any time

# Screen (for diagnosing boot issues — virsh screenshot can return STALE qxl
# frames; prefer vncdotool, which reads the live VNC framebuffer directly)
pip3 install --break-system-packages vncdotool   # one-time, already done on this box
export PATH="$HOME/.local/bin:$PATH"
vncdotool -s 127.0.0.1:0 capture /tmp/screen.png
# (VNC listens on 127.0.0.1:5900 i.e. display :0 — host-local only, not exposed)

# SSH once Windows is up and OpenSSH is running
ssh kpadmin@<vm-ip>   # get vm-ip via: sudo virsh domifaddr winvm-lp
                       # or: sudo virsh net-dhcp-leases default
```

### Snapshot / reset (clean state)

Not yet taken — pending a successful first boot into Windows with OpenSSH
confirmed reachable. Once confirmed, the plan is:

```bash
sudo virsh shutdown winvm-lp   # clean guest shutdown first
sudo virsh domstate winvm-lp   # wait for "shut off"
qemu-img snapshot -c winvm-clean-1 /mnt/devcache/winvm/disk/winvm.qcow2
qemu-img snapshot -l /mnt/devcache/winvm/disk/winvm.qcow2   # verify

# To reset to clean state later:
sudo virsh destroy winvm-lp   # if running
qemu-img snapshot -a winvm-clean-1 /mnt/devcache/winvm/disk/winvm.qcow2
sudo virsh start winvm-lp
```

(Internal qcow2 snapshots are the simplest option here — no extra files, and
`qemu-img snapshot -a` reverts disk state including the Windows install. The
OVMF NVRAM vars file `winvm_VARS.fd` is small and stable post-install so it
doesn't need its own snapshot.)

## License notes

- Image: Microsoft's official **Windows 11 Enterprise Evaluation** ISO (25H2,
  en-US, 64-bit), fetched via the public eval-center fwlink
  (`go.microsoft.com/fwlink/?linkid=2334167`) — no registration form, no
  account, direct signed download from `software-static.download.prss.microsoft.com`.
- **License: 90-day evaluation, no product key required.** Windows will prompt
  to activate but functions fully during the eval period. When it expires,
  the VM either needs `slmgr /rearm` (Enterprise eval supports a few rearm
  cycles extending the eval) or a fresh install from a re-downloaded ISO —
  cheap either way since this is a disposable, snapshot-driven test VM, not
  long-lived infrastructure. Not a concern for Phase 1/2 testing use.

## What Phase 2 needs from this box

- Interactive desktop auto-logon (configured in the unattend file —
  `kpadmin` auto-logs-on on every boot, `LogonCount` set high) so WebView2 CDP
  has a real interactive session to attach to, matching what the Azure VM
  lane already proved is required.
- OpenSSH Server enabled + firewall rule (configured via `FirstLogonCommands`
  in the unattend file).
- From there, Phase 2 is: install the dev toolchain (Node, Rust, Visual
  Studio Build Tools, WebView2 runtime), pull `keepance-3.0`, build, and
  drive it via `scripts/desktop-drive.mjs` the same way the Legion is driven
  today — but that is explicitly out of scope for this lane.

## Build notes / gotchas hit during Phase 1 (useful for whoever does Phase 2)

1. **Windows' "Press any key to boot from CD or DVD…" prompt cannot be
   reliably won by injecting keystrokes** — tried `virsh send-key` (libvirt/QMP),
   QEMU HMP `sendkey`, and real VNC keyboard events via `vncdotool` (with
   proper key-hold duration); none reliably landed within the ISO's own
   boot-countdown window, across dozens of attempts. **Fix:** Microsoft ships
   a no-prompt EFI boot image on every Windows install ISO at
   `efi/microsoft/boot/efisys_noprompt.bin` (vs. the default
   `efisys.bin`, which has the prompt baked in). The El Torito boot catalog's
   4-byte "Load RBA" pointer was located via a byte-offset scan
   (`efisys.bin` at LBA 536, matching `xorriso -report_el_torito`) and patched
   in a copy of the ISO to point at `efisys_noprompt.bin`'s LBA instead — this
   eliminates the prompt entirely with a ~4-byte edit, no ISO rebuild needed
   (rebuilding wasn't viable anyway: this xorriso build has no UDF support,
   and install.wim is >4GB so plain ISO9660 can't hold it).
2. **`virsh screenshot` can return a stale/cached qxl framebuffer.** When
   diagnosing boot hangs, cross-check with `vncdotool ... capture` (reads the
   live VNC framebuffer) — the two disagreed several times during Phase 1
   troubleshooting, and vncdotool was the reliable one.
3. Video device: **`qxl`** works and is what's currently configured (with
   `heads=1`, PCI address on bus `0x00` — a `virt-xml --add-device` retry
   during troubleshooting put it on the wrong bus, which silently prevented
   any display init at all; a plain `vga` swap was also tried and was
   strictly worse — never even showed the OVMF splash's boot spinner). If
   re-provisioning, `virt-install`'s default qxl placement is correct;
   don't move it.
4. Firmware: OVMF UEFI with Secure Boot (`OVMF_CODE_4M.ms.fd` /
   `OVMF_VARS_4M.ms.fd`, Microsoft keys pre-enrolled) + `swtpm`-emulated
   TPM 2.0 (`tpm-crb` model, required for q35 + Windows 11). This satisfies
   Windows 11's hardware checks properly (no LabConfig bypass hacks needed).
5. Disk/NIC use SATA (`ide-hd`/`ide-cd` under the AHCI controller) and
   `e1000e` respectively — both have in-box Windows drivers, so no
   driver-injection step is needed in the unattend file. This trades away
   virtio performance for a simpler, more reliable unattended install;
   revisit if Phase 2 needs faster disk/network I/O.
6. **Windows Setup after WinPE is genuinely slow on this host under
   contention** — CPU time climbs steadily (confirmed via
   `virsh dominfo | grep "CPU time"`) with no visible screen change and zero
   qcow2 disk-block growth for extended stretches; this is expected (WinPE
   runs from RAM, doesn't touch the target disk until partitioning starts)
   and is not a hang — but it means "no visible progress for 10+ minutes"
   is not itself a reliable signal something is wrong. Check CPU time
   deltas, not just the screen or disk size, before concluding a stall.

7. **Open question for whoever continues:** after WinPE, the display cycles
   between a small set of frames (OVMF splash+spinner at 1280x800, blank
   frames at both 640x480 and 1280x800) without ever settling into something
   clearly identifiable as Setup's graphical UI, for 15-20+ minutes, with the
   qcow2 disk never growing past its initial ~330KB (meaning partitioning
   never started). CPU time keeps climbing throughout (ruled out a true hang).
   Two explanations remain open: (a) it's genuinely just slow on this shared
   host (WinPE runs entirely off the ISO/RAM, so no disk growth is expected
   until partitioning — plausible but unconfirmed), or (b) it's crashing and
   auto-rebooting in a loop before ever reaching Setup's GUI (Windows'
   default "auto restart on failure" would hide a BSOD from casual polling).
   **Next diagnostic steps if this recurs:**
   - Poll the screen every 2-3s for a full minute right after start — a BSOD
     frame is usually visible for several seconds before an auto-reboot.
   - Try disabling the Hyper-V enlightenments virt-install added for the
     `win11` os-variant (`hv-time`, `hv-relaxed`, `hv-vapic`,
     `hv-spinlocks=0x1fff` in the domain XML's `<hyperv>` block) — these are
     a known source of instability in some QEMU/OVMF + emulated-TPM
     combinations and aren't required for Windows to boot, just for
     paravirt performance hints.
   - Or just let it run untouched for a long stretch (30-60 min) with zero
     interaction — repeated VNC reconnects while diagnosing may themselves
     add load; a hands-off 5-minute window during this session showed the
     same steady CPU climb as an interactively-polled window, so this is a
     secondary suspicion, not a strong lead.

## Success bar (from the brief)

`ssh kpadmin@<vm-ip> "ver"` returns the Windows version, and a clean qcow2
snapshot exists. **Not yet met** — see status line at the top of this doc.
