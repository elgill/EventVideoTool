//! Runs a real export onto a genuinely full disk with the bundled ffmpeg, and
//! checks the app's handling end to end: the free-space check refuses it up
//! front, and if ffmpeg runs anyway (an estimate can be wrong), the failure
//! is recognized as disk-full, the truncated partial file is removed, and a
//! previous export at the chosen path survives.
//!
//! It needs a tiny volume, so it's ignored by default. To run it on Windows
//! without admin rights, use a 2 MB tmpfs in WSL:
//!
//! ```sh
//! wsl -u root -- sh -c 'mkdir -p /mnt/evt-full && mount -t tmpfs -o size=2m tmpfs /mnt/evt-full && chmod 777 /mnt/evt-full'
//! EVT_FULL_DISK_DIR=//wsl.localhost/Ubuntu/mnt/evt-full cargo test --test disk_full -- --ignored
//! ```
//!
//! On Linux/macOS, any small mount works (e.g. `mount -t tmpfs -o size=2m`).

use eventvideotool_app_lib::clips::{self, ClipInfo};
use eventvideotool_app_lib::export::{self, ExportErrorKind, SegmentSource};
use eventvideotool_app_lib::ffmpeg::args::{build_export_args, ExportOptions};

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn find_sidecar(name: &str) -> PathBuf {
    let binaries_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
    fs::read_dir(&binaries_dir)
        .expect("no staged binaries; run `npm run prepare:ffmpeg` first")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(&format!("{name}-")))
        })
        .unwrap_or_else(|| panic!("no staged {name} binary"))
}

/// A clip that compresses badly (noise), so a few seconds is many MB.
fn generate_big_clip(ffmpeg: &Path, dest: &Path) {
    let status = Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=duration=6:size=1280x720:rate=30,noise=alls=60:allf=t",
            "-c:v",
            "libx264",
            "-b:v",
            "8M",
            "-pix_fmt",
            "yuv420p",
            "-y",
        ])
        .arg(dest)
        .status()
        .unwrap();
    assert!(status.success());
}

#[test]
#[ignore = "needs a tiny volume; set EVT_FULL_DISK_DIR (see module docs)"]
fn export_onto_a_full_disk_is_refused_or_cleaned_up() {
    let full_dir = PathBuf::from(
        std::env::var("EVT_FULL_DISK_DIR")
            .expect("set EVT_FULL_DISK_DIR to a directory on a volume of a few MB"),
    );
    let ffmpeg = find_sidecar("ffmpeg");

    let work = tempfile::tempdir().unwrap();
    let clip_path = work.path().join("clip.mp4");
    generate_big_clip(&ffmpeg, &clip_path);
    let clip_bytes = fs::metadata(&clip_path).unwrap().len();

    let clip_list = [ClipInfo {
        path: clip_path.to_string_lossy().into_owned(),
        name: "clip.mp4".into(),
        duration_secs: Some(6.0),
    }];
    let segments = clips::plan_segments(&clip_list, None, None).unwrap();

    // A previous export the user chose to overwrite.
    let output = full_dir.join("race.mp4");
    let partial = export::partial_path(&output);
    let _ = fs::remove_file(&partial);
    fs::write(&output, vec![7u8; 64 * 1024]).unwrap();

    // 1. The free-space check catches it before ffmpeg starts, on volumes
    //    that report their free space honestly. Network shares may not: the
    //    WSL share reports the whole Linux disk rather than the tmpfs, which
    //    is exactly the case step 2 exists for.
    let available = fs4::available_space(&full_dir).expect("could not read free space");
    if available < clip_bytes {
        let estimate = export::estimate_output_bytes(
            &[SegmentSource {
                file_bytes: clip_bytes,
                clip_secs: 6.0,
                segment_secs: segments[0].duration_secs,
            }],
            false,
        );
        let refused = export::check_free_space(estimate, available, &full_dir).unwrap_err();
        assert_eq!(refused.kind, ExportErrorKind::DiskFull);
    } else {
        eprintln!(
            "note: {} reports {available} bytes free, more than it really has; \
             skipping the free-space check and testing the failure path only",
            full_dir.display()
        );
    }

    // 2. The check passed (or was fooled): ffmpeg writes the partial file until
    //    the disk fills, exactly as `export_video` runs it.
    let filelist = clips::temp_filelist_path();
    clips::write_filelist(&filelist, &segments).unwrap();
    let partial_file = partial.to_string_lossy().into_owned();
    let args = build_export_args(&ExportOptions {
        filelist_path: &filelist,
        seek_secs: None,
        output_file: &partial_file,
        mute: false,
        re_encode: false,
        hw_acceleration: false,
        hw_encoder: None,
    });
    let run = Command::new(&ffmpeg)
        .args(["-hide_banner", "-nostats", "-loglevel", "error"])
        .args(&args)
        .output()
        .unwrap();
    let _ = fs::remove_file(&filelist);
    let stderr = String::from_utf8_lossy(&run.stderr).into_owned();

    assert!(!run.status.success(), "ffmpeg unexpectedly fit the export");
    assert!(
        partial.exists(),
        "expected ffmpeg to leave a truncated partial file"
    );

    export::finalize_output(&partial, &output, false).unwrap();
    let err = export::describe_ffmpeg_failure(&stderr, &full_dir);

    assert_eq!(err.kind, ExportErrorKind::DiskFull, "stderr was: {stderr}");
    assert!(!partial.exists(), "partial file should be cleaned up");
    assert_eq!(
        fs::read(&output).unwrap(),
        vec![7u8; 64 * 1024],
        "the previous export should be untouched"
    );

    fs::remove_file(&output).unwrap();
}
