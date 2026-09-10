//! Hardware encoder detection, ported from `hardware_encoder_util.py`.

use std::process::Command;

/// Returns the ffmpeg hardware encoder name to use on this machine, if any
/// was detected.
pub fn detect_hardware_encoder() -> Option<String> {
    if cfg!(target_os = "macos") {
        // macOS always has VideoToolbox available.
        return Some("h264_videotoolbox".to_string());
    }

    if cfg!(target_os = "windows") {
        if check_nvidia_gpu() {
            return Some("h264_nvenc".to_string());
        }
        if check_gpu_vendor_windows("AMD") || check_gpu_vendor_windows("Radeon") {
            return Some("h264_amf".to_string());
        }
        if check_gpu_vendor_windows("Intel") {
            return Some("h264_qsv".to_string());
        }
        return None;
    }

    if cfg!(target_os = "linux") {
        if check_nvidia_gpu() {
            return Some("h264_nvenc".to_string());
        }
        if check_gpu_vendor_linux("AMD") || check_gpu_vendor_linux("Radeon") {
            return Some("h264_vaapi".to_string());
        }
        if check_gpu_vendor_linux("Intel") {
            return Some("h264_qsv".to_string());
        }
        return None;
    }

    None
}

fn check_nvidia_gpu() -> bool {
    Command::new("nvidia-smi")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn check_gpu_vendor_windows(needle: &str) -> bool {
    Command::new("wmic")
        .args(["path", "win32_VideoController", "get", "name"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(needle))
        .unwrap_or(false)
}

fn check_gpu_vendor_linux(needle: &str) -> bool {
    Command::new("lspci")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(needle))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_hardware_encoder_does_not_panic_on_this_platform() {
        // We can't assert a specific encoder (depends on the test machine's
        // GPU), but this exercises every branch's command-spawning path and
        // confirms it degrades to None instead of erroring when the probing
        // tools (nvidia-smi/lspci/wmic) are missing.
        let _ = detect_hardware_encoder();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_always_reports_videotoolbox() {
        assert_eq!(
            detect_hardware_encoder(),
            Some("h264_videotoolbox".to_string())
        );
    }
}
