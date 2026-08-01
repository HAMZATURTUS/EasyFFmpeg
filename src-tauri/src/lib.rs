use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Child, Stdio};
use tauri::{AppHandle, Emitter};
use std::sync::Mutex;

static FFMPEG_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

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

// Get the duration of a file in seconds using ffprobe.
#[tauri::command]
fn probe_file(path: String) -> Result<f64, String> {
    let output = Command::new("ffprobe")
        .args(["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", &path])
        .output()
        .map_err(|e| e.to_string())?;

    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<f64>()
        .map_err(|_| "Could not read duration. File may not be a supported media format.".to_string())
}

#[tauri::command]
async fn convert_file(
    app: AppHandle,
    input_path: String,
    output_path: String,
    duration: f64,
    trim_start: String,
    trim_end: String,
    quality: String,
    resolution: String,
    video_codec: String,
    audio_codec: String
) -> Result<String, String> {

    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y")
    .arg("-loglevel")
    .arg("error")
    .arg("-progress").arg("pipe:1")
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());


    if !trim_start.is_empty() {
        cmd.arg("-ss").arg(trim_start);
    }
    if !trim_end.is_empty() {
        cmd.arg("-to").arg(trim_end);
    }
    cmd.arg("-i").arg(&input_path);

    if !quality.is_empty() {
        cmd.arg("-crf").arg(quality);
    }
    if !resolution.is_empty() {
        cmd.arg("-vf").arg(format!("scale=-2:{}", resolution));
    }
    if !audio_codec.is_empty() {
        cmd.arg("-c:a").arg(audio_codec);
    }
    if !video_codec.is_empty() {
        cmd.arg("-c:v").arg(video_codec);
    }

    cmd.arg(&output_path);

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    // error message receiver
    let stderr = child.stderr.take().unwrap();
    let mut stderr_thread = Some(std::thread::spawn(move || {
        let mut s = String::new();
        BufReader::new(stderr).read_to_string(&mut s).ok();
        s
    }));
    
    // progress tracker (allegedly)
    if let Some(stdout) = child.stdout.take() {
        let app_clone = app.clone();
        
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let line = line.unwrap_or_default();
                if line.starts_with("out_time_us=") {
                    let us: f64 = line["out_time_us=".len()..].parse().unwrap_or(0.0);
                    if duration > 0.0 {
                        let percent = (us / 1_000_000.0 / duration * 100.0).min(99.0);
                        let _ = app_clone.emit("conversion-progress", percent);
                    }
                }
            }
        });
    }

    *FFMPEG_PROCESS.lock().unwrap() = Some(child);

    loop {
        let process_status = {
            let mut process_guard = FFMPEG_PROCESS.lock().unwrap();
            
            if let Some(child_process) = process_guard.as_mut() {
                match child_process.try_wait() {
                    Ok(Some(status)) => {
                        *process_guard = None;
                        if status.success() {
                            Ok(Some("Success".to_string()))
                        } else {
                            let error_msg = stderr_thread
                                .take()
                                .and_then(|t| t.join().ok())
                                .unwrap_or_default();
                            
                            let msg = error_msg
                                .lines()
                                .filter(|l| !l.trim().is_empty())
                                .last()
                                .unwrap_or("FFmpeg failed. Make sure the input file is valid and FFmpeg is installed.")
                                .to_string();
                            Err(msg)
                        }
                    }
                    Ok(None) => Ok(None),
                    Err(e) => {
                        *process_guard = None;
                        Err(e.to_string())
                    }
                }
            } else {
                Err("Cancelled".to_string())
            }
        };

        
        match process_status {
            Ok(Some(success_msg)) => return Ok(success_msg),
            Err(error_msg) => return Err(error_msg),
            Ok(None) => {}
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}

#[tauri::command]
async fn cancel_conversion() -> () {
    let mut process_guard = FFMPEG_PROCESS.lock().unwrap();

    if let Some(mut child) = process_guard.take() {
        let pid = child.id();
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
        let _ = child.wait();
    }
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    let parent = std::path::Path::new(&path)
        .to_string_lossy()
        .to_string();

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
                                                    convert_file,
                                                    cancel_conversion,
                                                    probe_file,
                                                    reveal_in_folder
                                                    ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
