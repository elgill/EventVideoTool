pub mod clips;
mod commands;
pub mod ffmpeg;
pub mod hwaccel;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::detect_hw_encoder,
            commands::list_clips,
            commands::concat_clips,
            commands::process_video,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
