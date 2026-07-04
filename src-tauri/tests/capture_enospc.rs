//! QA-35 — isolating the real chunk-writer behavior when a disk write fails
//! mid-recording, at the Rust layer, with a REAL OS-level write failure (not
//! a mock) — per the fix brief's ask to prove this at the unit/Rust level
//! first.
//!
//! Technique: `setrlimit(RLIMIT_FSIZE, ...)` + ignoring `SIGXFSZ` makes any
//! `write()` past a byte limit fail with a genuine `io::Error` (kind
//! `FileTooLarge`, errno `EFBIG`) instead of killing the process. This is
//! the same *effect* a real out-of-space `ENOSPC` has on this module's code
//! (an `Err` returned from a write/flush call it already handles identically
//! regardless of which errno caused it) without needing root/mount
//! privileges to build a real quota'd filesystem, which this sandbox doesn't
//! have. Deliberately a SEPARATE integration-test binary (not a `#[cfg(test)]`
//! unit test inside the crate): `RLIMIT_FSIZE` is process-wide, and cargo
//! runs all unit tests for a crate as threads inside ONE process — capping
//! file size there would risk breaking unrelated concurrently-running tests
//! that legitimately write larger files. Each file under `tests/` compiles to
//! its own process, so this file's rlimit change can't leak anywhere else.
//!
//! ALL THREE questions below live in ONE `#[test]` function, run
//! sequentially — not three separate `#[test]` fns. `cargo test` runs every
//! `#[test]` in a file as a separate THREAD inside the same process by
//! default, and `RLIMIT_FSIZE` is process-wide, not per-thread: three
//! separate tests each capping/lifting the same process-wide limit raced
//! each other in an earlier version of this file (confirmed: interleaved
//! `cap`/`lift` calls produced spurious `EFBIG` failures in tests that had
//! already "lifted" the cap). One sequential test eliminates that race
//! entirely.
//!
//! Unix-only: `RLIMIT_FSIZE`/`SIGXFSZ` are POSIX, not available on Windows —
//! matches the existing `#[cfg(unix)]` precedent for a permissions-based
//! disk-failure simulation in session.rs's own test module.

#![cfg(unix)]

use lantern_lib::commands::capture::chunks::{ChunkWriter, SAMPLE_RATE};
use lantern_lib::commands::capture::session::finalize_session;

fn get_fsize_rlimit() -> libc::rlimit {
    unsafe {
        let mut current: libc::rlimit = std::mem::zeroed();
        let r = libc::getrlimit(libc::RLIMIT_FSIZE, &mut current);
        assert_eq!(r, 0, "getrlimit(RLIMIT_FSIZE) failed: {}", std::io::Error::last_os_error());
        current
    }
}

/// Caps this process's max file size at `limit_bytes` and makes exceeding it
/// return `EFBIG` from the failing `write()`/`flush()` call instead of
/// delivering `SIGXFSZ` (whose default disposition is to kill the process).
/// Only ever touches the SOFT limit (`rlim_cur`) — the HARD limit
/// (`rlim_max`) is deliberately left exactly as `getrlimit` found it and
/// never lowered: an unprivileged process can freely raise its soft limit
/// back up to the hard limit, but can NEVER raise the hard limit itself back
/// up once lowered (that needs `CAP_SYS_RESOURCE`), which would make
/// `lift_file_size_cap` below unable to ever undo this (confirmed: an
/// earlier version of this helper lowered `rlim_max` too, and the "restore"
/// call failed with EPERM).
fn cap_max_file_size(limit_bytes: u64) {
    unsafe {
        libc::signal(libc::SIGXFSZ, libc::SIG_IGN);
        let current = get_fsize_rlimit();
        let rlim = libc::rlimit { rlim_cur: limit_bytes, rlim_max: current.rlim_max };
        let r = libc::setrlimit(libc::RLIMIT_FSIZE, &rlim);
        assert_eq!(r, 0, "setrlimit(RLIMIT_FSIZE) failed: {}", std::io::Error::last_os_error());
    }
}

/// Restores the soft limit back to the (untouched) hard limit.
fn lift_file_size_cap() {
    unsafe {
        let current = get_fsize_rlimit();
        let rlim = libc::rlimit { rlim_cur: current.rlim_max, rlim_max: current.rlim_max };
        let r = libc::setrlimit(libc::RLIMIT_FSIZE, &rlim);
        assert_eq!(r, 0, "setrlimit(RLIMIT_FSIZE) restore failed: {}", std::io::Error::last_os_error());
    }
}

/// Writes 1-second (`SAMPLE_RATE` samples) buffers to `w` until one fails,
/// returning how many buffers succeeded before the first failure, plus the
/// error itself. Panics if nothing ever fails within `max_seconds` (the cap
/// would have to be misconfigured for that to happen, since each 1s buffer
/// is 32KB of PCM16 data).
fn write_until_failure(w: &mut ChunkWriter, max_seconds: u32) -> (u32, anyhow::Error) {
    let one_sec = vec![0i16; SAMPLE_RATE as usize];
    for i in 0..max_seconds {
        if let Err(e) = w.write(&one_sec) {
            return (i, e);
        }
    }
    panic!("expected a write failure within {max_seconds}s of silence — cap_max_file_size may not be taking effect");
}

/// QA-35, all three Rust-layer questions, proven end to end with a REAL OS
/// write failure:
///
/// 1. Does a chunk-write failure actually propagate as an `Err` (not get
///    silently swallowed), and does the partially-written chunk file remain
///    a VALID, parseable WAV once the writer is dropped WITHOUT `finish()`
///    ever being called — exactly how `AsyncChunkWriter`'s writer thread
///    really behaves on a real failure (see its `spawn` doc)? A "no" here
///    would mean `finalize_session` aborts recovery of the ENTIRE meeting on
///    this one truncated chunk, not just its own tail — a real
///    crash-durability regression, not just a UX gap.
///
/// 2. Once the write failure has happened and the recording is stopped
///    (mirroring qa5's own evidence: space was freed before the successful
///    Stop), does `finalize_session` preserve exactly the audio that really
///    made it to disk — the mic channel truncated at the failure point, the
///    sys channel intact — rather than corrupting or discarding the partial
///    recording?
///
/// 3. The honest worst case qa5 flagged as untested: if disk space is STILL
///    exhausted at Stop time, `finalize_session`'s own merge write will also
///    fail — does that failure avoid deleting `.capture/` (and therefore
///    avoid losing the raw chunks still sitting on disk)?
#[test]
fn qa35_enospc_mid_recording_write_failure_end_to_end() {
    // ---- Q1: a real write failure mid-chunk propagates, and the truncated
    // chunk survives a drop-without-finish as a still-valid WAV. ----
    let dir1 = tempfile::tempdir().unwrap();
    // 3 full 1s buffers (32_000 bytes each) fit comfortably under 120_000
    // bytes (96_044 incl. the 44-byte header); a 4th would need 128_044,
    // over the cap — deterministic regardless of BufWriter's internal flush
    // granularity, unlike a cap sized to fail within the FIRST buffer.
    cap_max_file_size(120_000);
    let mut w = ChunkWriter::new(dir1.path(), "mic").unwrap();
    let (succeeded_seconds, err) = write_until_failure(&mut w, 20);
    assert_eq!(succeeded_seconds, 3, "expected exactly 3 full 1s buffers to fit under the 120_000-byte cap");
    let err_msg = err.to_string().to_lowercase();
    assert!(
        err_msg.contains("large") || err_msg.contains("space"),
        "expected an EFBIG/ENOSPC-shaped error, got: {err_msg}"
    );
    // AsyncChunkWriter's writer thread never calls `.finish()` on a real
    // write failure — it just lets the `ChunkWriter` drop when its channel
    // closes (see AsyncChunkWriter::spawn's loop + chunks.rs's Drop impl).
    // Simulate that exactly: drop, don't finish.
    drop(w);
    lift_file_size_cap();

    let chunk_path = dir1.path().join("mic-000001.wav");
    assert!(chunk_path.exists(), "the partially-written chunk file must still exist on disk");
    let reader = hound::WavReader::open(&chunk_path).expect(
        "the partial chunk must still be a PARSEABLE WAV file after a mid-write failure + drop \
         (Drop::drop's own w.finalize() only patches the fixed 44-byte header in place, which \
         needs no new disk space — if this fails, finalize_session would abort recovery of the \
         ENTIRE meeting on this one truncated chunk, not just its own tail)",
    );
    assert_eq!(reader.len() as u32, 3 * SAMPLE_RATE, "exactly the 3 successful seconds must be on disk");

    // ---- Q2: once space is freed, finalize_session preserves exactly what
    // made it to disk — mic truncated, sys intact. ----
    let meeting_dir = tempfile::tempdir().unwrap();
    let cap_dir = meeting_dir.path().join(".capture");

    cap_max_file_size(120_000);
    let mut mic_writer = ChunkWriter::new(&cap_dir, "mic").unwrap();
    let (mic_seconds_written, _err) = write_until_failure(&mut mic_writer, 20);
    assert_eq!(mic_seconds_written, 3);
    drop(mic_writer); // same real shutdown path as AsyncChunkWriter's thread
    lift_file_size_cap(); // "space was freed" — sys channel + finalize both need to write for real

    // sys channel recorded normally for longer than mic's truncated portion.
    let mut sys_writer = ChunkWriter::new(&cap_dir, "sys").unwrap();
    let sys_seconds = mic_seconds_written + 2;
    let one_sec = vec![7i16; SAMPLE_RATE as usize];
    for _ in 0..sys_seconds {
        sys_writer.write(&one_sec).unwrap();
    }
    sys_writer.finish().unwrap();

    let audio_path = finalize_session(meeting_dir.path())
        .expect("finalize_session must succeed once disk space is available again");
    assert!(audio_path.exists(), "audio.wav must exist");

    let mut reader = hound::WavReader::open(&audio_path).unwrap();
    assert_eq!(reader.spec().channels, 2, "stereo: mic=L, sys=R");
    let samples: Vec<i16> = reader.samples::<i16>().map(|s| s.unwrap()).collect();
    let frames = samples.len() / 2;
    // Padded to the LONGER (sys) channel's length, per finalize_session's own
    // documented zero-padding behavior for a shorter channel.
    assert_eq!(frames, (sys_seconds as usize) * SAMPLE_RATE as usize);

    let right_channel_all_real =
        samples.iter().skip(1).step_by(2).all(|&s| s == 7);
    assert!(right_channel_all_real, "sys (right) channel must be fully intact, not truncated");
    // mic (left) truncates at exactly 3s of real (silent, value 0) audio,
    // then zero-padding for the remaining (sys_seconds - 3)s — both are 0,
    // so the per-sample value can't distinguish them here; the truncation
    // itself is already proven above (mic_seconds_written == 3, confirmed on
    // disk before finalize even ran). The assertion that matters at THIS
    // step is simply that finalize_session didn't panic/corrupt and produced
    // exactly the expected total length.

    // ---- Q3: the honest worst case — disk STILL full at Stop time. ----
    let meeting_dir2 = tempfile::tempdir().unwrap();
    let cap_dir2 = meeting_dir2.path().join(".capture");
    {
        // Give both channels one full valid chunk with plenty of headroom.
        let mut mic_writer2 = ChunkWriter::new(&cap_dir2, "mic").unwrap();
        mic_writer2.write(&vec![1i16; 1_000]).unwrap();
        mic_writer2.finish().unwrap();
        let mut sys_writer2 = ChunkWriter::new(&cap_dir2, "sys").unwrap();
        sys_writer2.write(&vec![2i16; 1_000]).unwrap();
        sys_writer2.finish().unwrap();
    }
    // NOW clamp the cap so low that finalize_session's brand-new audio.wav
    // (which starts from a 44-byte header, well under even a few hundred
    // bytes of merged samples) cannot be written at all — disk is still full
    // at Stop time, the worst case qa5 flagged as untested.
    cap_max_file_size(20);
    let result = finalize_session(meeting_dir2.path());
    lift_file_size_cap();

    assert!(result.is_err(), "finalize_session must fail honestly when it truly cannot write, not silently truncate/succeed");
    assert!(cap_dir2.exists(), ".capture/ (the only remaining copy of the raw chunks) must survive a failed finalize");
    assert!(cap_dir2.join("mic-000001.wav").exists());
    assert!(cap_dir2.join("sys-000001.wav").exists());
    // The failed write can still leave a PARTIAL audio.wav on disk (however
    // much of hound's internal buffer made it out before EFBIG) — the
    // honest-behavior invariant isn't "0 bytes," it's "never a file that
    // LOOKS like a complete, valid recording": either nothing exists, or
    // whatever exists is small enough / broken enough that hound itself
    // refuses to parse it as a valid WAV.
    let audio_after_failed_finalize = meeting_dir2.path().join("audio.wav");
    if audio_after_failed_finalize.exists() {
        assert!(
            hound::WavReader::open(&audio_after_failed_finalize).is_err(),
            "a partial audio.wav left behind by a failed finalize must not be openable as a valid \
             WAV — that would look like a complete, trustworthy recording when it isn't"
        );
    }
}
