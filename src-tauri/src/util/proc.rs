/// Suppress the console window when spawning a child process on Windows.
/// On Windows GUI apps, child processes inherit the parent's subsystem; without
/// the `CREATE_NO_WINDOW` flag a console window briefly flashes for every
/// spawned process. This helper sets the flag on `std::process::Command`.
/// No-op on other platforms.
pub fn hide_console(cmd: &mut std::process::Command) -> &mut std::process::Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Same as `hide_console` but for `tokio::process::Command`.
/// No-op on other platforms.
pub fn hide_console_tokio(cmd: &mut tokio::process::Command) -> &mut tokio::process::Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Open `url` in the user's default browser.
///
/// On Windows we call the Win32 `ShellExecuteW` "open" verb directly — the
/// canonical way to launch the default browser. Two earlier approaches both
/// failed (BUG-010):
///   - `rundll32 url.dll,FileProtocolHandler <url>` silently fails to launch
///     some default browsers (observed on Vivaldi/Chrome), so the OAuth flow
///     just hung and timed out; and
///   - `cmd /C start "" <url>` (what the `open` crate uses on Windows) lets the
///     shell parse the URL, so an OAuth URL's `&` is read as a command
///     separator and the URL is mangled.
/// `ShellExecuteW` takes the URL as a real wide-string argument (no shell
/// parsing — `&`/`%` stay intact) and reliably opens the default browser, with
/// no console window. Best-effort: logs a warning on failure (callers can also
/// surface a copy-paste / device-code fallback).
pub fn open_url(url: &str) {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        // NUL-terminated UTF-16 for the Win32 W-API.
        let to_wide = |s: &str| -> Vec<u16> {
            OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
        };
        let verb = to_wide("open");
        let file = to_wide(url);
        // SAFETY: both pointers reference NUL-terminated buffers that outlive the
        // call; the remaining args are null/constant as ShellExecuteW expects.
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                file.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        // ShellExecuteW returns a value > 32 on success (it's a legacy HINSTANCE).
        if (result as isize) <= 32 {
            log::warn!("ShellExecuteW failed to open URL (code {})", result as isize);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Err(e) = open::that(url) {
            log::warn!("could not open browser automatically: {e}");
        }
    }
}
