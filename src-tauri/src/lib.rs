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

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    let parent = std::path::Path::new(&path)
        .parent()
        .ok_or("Could not find the parent folder.")?
        .to_string_lossy()
        .to_string();

    #[cfg(target_os = "windows")]
    Command::new("explorer").arg(&parent).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    Command::new("open").arg(&parent).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    Command::new("xdg-open").arg(&parent).spawn().map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![   greet,
                                                    convert_filetype,
                                                    reveal_in_folder
                                                    ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
