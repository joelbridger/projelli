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

/// Open `url` in the user's default browser without flashing a console window.
///
/// On Windows, the `open` crate shells out via `cmd /C start`, which pops a
/// console window for a moment (and mishandles `&` / `%` in OAuth URLs). Instead
/// we invoke `rundll32 url.dll,FileProtocolHandler <url>` with `CREATE_NO_WINDOW`:
/// the URL is passed as a direct process argument (no shell parsing) so query
/// strings stay intact, and no console window appears. Best-effort: logs a
/// warning on failure (the caller can also surface a copy-paste fallback).
pub fn open_url(url: &str) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        if let Err(e) = std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            log::warn!("could not open browser automatically: {e}");
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Err(e) = open::that(url) {
            log::warn!("could not open browser automatically: {e}");
        }
    }
}
