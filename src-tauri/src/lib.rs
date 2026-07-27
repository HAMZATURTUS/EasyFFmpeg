use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader, Read};
use std::sync::Mutex;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use serde::{Serialize, Deserialize};

// Stores the PID of each active conversion so we can cancel it later.
pub struct JobStore(pub Mutex<HashMap<String, u32>>);

// Sent to the frontend on every progress tick.
#[derive(Serialize, Clone)]
struct ProgressEvent {
    id: String,
    percent: f64,
}

// Conversion settings passed in from the frontend.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConvertOptions {
    audio_only: bool,            // true for mp3/aac/flac/wav etc. — adds -vn
    crf: Option<u32>,            // quality: 18=high, 23=balanced, 28=small
    scale: Option<String>,       // resolution, e.g. "-2:720" for 720p
    trim_start: Option<String>,  // e.g. "00:00:10"
    trim_end: Option<String>,    // e.g. "00:01:30"
    video_codec: Option<String>, // e.g. "libx264"
    audio_codec: Option<String>, // e.g. "libmp3lame"
}

// Get the duration of a file in seconds using ffprobe.
// This is needed so we can calculate the progress percentage during conversion.
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

// Run FFmpeg on a single file and emit progress events as it works.
// The frontend listens for "conversion-progress" events to update the progress bar.
#[tauri::command]
async fn convert_file(
    app: AppHandle,
    jobs: tauri::State<'_, JobStore>,
    id: String,
    input: String,
    output: String,
    duration: f64,
    options: ConvertOptions,
) -> Result<String, String> {
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y").arg("-loglevel").arg("error");

    // Trim: seek before -i so FFmpeg skips rather than decodes (much faster)
    if let Some(ref s) = options.trim_start {
        if !s.is_empty() { cmd.arg("-ss").arg(s); }
    }
    cmd.arg("-i").arg(&input);

    // Trim end
    if let Some(ref e) = options.trim_end {
        if !e.is_empty() { cmd.arg("-to").arg(e); }
    }

    // Video codec, quality, and resolution
    if options.audio_only {
        cmd.arg("-vn"); // strip video stream — required for audio-only formats like mp3/aac/flac
    } else if let Some(ref vc) = options.video_codec {
        cmd.arg("-c:v").arg(vc);
    }
    if let Some(crf) = options.crf {
        cmd.arg("-crf").arg(crf.to_string());
    }
    if let Some(ref sc) = options.scale {
        cmd.arg("-vf").arg(format!("scale={}", sc));
    }

    // Audio codec
    if let Some(ref ac) = options.audio_codec {
        cmd.arg("-c:a").arg(ac);
    }

    // -progress - sends machine-readable progress lines to stdout.
    // We read these to calculate the percentage. Error messages still go to stderr.
    cmd.arg("-progress").arg("-").arg(&output);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn()
        .map_err(|e| format!("Could not start FFmpeg: {}. Is FFmpeg installed and on your PATH?", e))?;

    // Save the PID so cancel_conversion can kill this process if needed
    jobs.0.lock().unwrap().insert(id.clone(), child.id());

    // Read stderr in a separate thread so its buffer never fills up and blocks FFmpeg
    let stderr = child.stderr.take().unwrap();
    let stderr_thread = std::thread::spawn(move || {
        let mut s = String::new();
        BufReader::new(stderr).read_to_string(&mut s).ok();
        s
    });

    // Read FFmpeg's progress output line by line and emit events to the frontend
    let stdout = child.stdout.take().unwrap();
    for line in BufReader::new(stdout).lines() {
        let line = line.unwrap_or_default();
        // "out_time_us=4000000" means FFmpeg is 4 seconds into the file (in microseconds)
        if line.starts_with("out_time_us=") {
            let us: f64 = line["out_time_us=".len()..].parse().unwrap_or(0.0);
            if duration > 0.0 {
                let percent = (us / 1_000_000.0 / duration * 100.0).min(99.0);
                let _ = app.emit("conversion-progress", ProgressEvent { id: id.clone(), percent });
            }
        }
    }

    // Remove the job and wait for FFmpeg to fully exit
    jobs.0.lock().unwrap().remove(&id);
    let status = child.wait().map_err(|e| e.to_string())?;
    let error_msg = stderr_thread.join().unwrap_or_default();

    if status.success() {
        Ok("done".to_string())
    } else {
        // Show the last non-empty line from FFmpeg's error output
        let msg = error_msg
            .lines()
            .filter(|l| !l.trim().is_empty())
            .last()
            .unwrap_or("FFmpeg failed. Make sure the input file is valid and FFmpeg is installed.")
            .to_string();
        Err(msg)
    }
}

// Kill a running conversion by its job ID.
#[tauri::command]
fn cancel_conversion(jobs: tauri::State<'_, JobStore>, id: String) {
    if let Some(pid) = jobs.0.lock().unwrap().remove(&id) {
        #[cfg(target_os = "windows")]
        { let _ = Command::new("taskkill").args(["/F", "/PID", &pid.to_string()]).output(); }
        #[cfg(not(target_os = "windows"))]
        { let _ = Command::new("kill").args(["-9", &pid.to_string()]).output(); }
    }
}

// Open the folder that contains the given file path.
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

// Check whether ffmpeg is available on this system's PATH.
#[tauri::command]
fn check_ffmpeg() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

// Open a terminal window and run the platform-appropriate install command.
// On Windows: winget install Gyan.FFmpeg
// On macOS:   brew install ffmpeg  (via Terminal.app)
// On Linux:   apt install ffmpeg   (via x-terminal-emulator)
#[tauri::command]
fn open_ffmpeg_install() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    Command::new("cmd")
        .args([
            "/c", "start", "powershell", "-NoExit", "-Command",
            "Write-Host 'Installing FFmpeg via winget...' -ForegroundColor Cyan; \
             winget install Gyan.FFmpeg --source winget; \
             Write-Host 'Done! Close this window and click Check Again in EasyFFmpeg.' -ForegroundColor Green",
        ])
        .spawn()
        .map_err(|e| format!("Could not open PowerShell: {}", e))?;

    #[cfg(target_os = "macos")]
    Command::new("osascript")
        .args(["-e", "tell application \"Terminal\" to do script \"brew install ffmpeg\""])
        .spawn()
        .map_err(|e| format!("Could not open Terminal: {}", e))?;

    #[cfg(target_os = "linux")]
    Command::new("x-terminal-emulator")
        .args(["-e", "bash -c 'sudo apt install -y ffmpeg; echo Done. Press Enter to close; read'" ])
        .spawn()
        .or_else(|_| Command::new("gnome-terminal")
            .args(["--", "bash", "-c",
                   "sudo apt install -y ffmpeg; echo Done; read -p 'Press Enter to close'"])
            .spawn())
        .map_err(|e| format!("Could not open terminal: {}", e))?;

    Ok(())
}


pub fn run() {
    tauri::Builder::default()
        .manage(JobStore(Mutex::new(HashMap::new()))) // shared job store for cancel support
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![   // all commands in one handler (bug fix)
            probe_file,
            convert_file,
            cancel_conversion,
            reveal_in_folder,
            check_ffmpeg,
            open_ffmpeg_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
