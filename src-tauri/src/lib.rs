use std::process::Command;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn convert_filetype(original_filepath: String, dest_filepath: String) -> Result<String, String> {
    let output = Command::new("ffmpeg")
                .arg("-y")
                .arg("-i")
                .arg(original_filepath)
                .arg(dest_filepath)
                .output()
                .unwrap();
    if output.status.success() {
        Ok("Success".to_string())
    } else {
        let error_msg = String::from_utf8_lossy(&output.stderr);
        Err(error_msg.to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .invoke_handler(tauri::generate_handler![convert_filetype])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
