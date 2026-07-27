# EasyFFmpeg — All Changes Made

A full record of every file that was created or modified, what was changed, and why.

---

## `index.html` — REPLACED

**Before:** A 40 KB standalone demo/prototype HTML file (the original visual mockup).  
**After:** A 12-line Vite entry point that boots the real React app.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>EasyFFmpeg</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Why:** Vite uses this file as the entry point for the dev server. It was replaced with
our demo HTML, so the Tauri app was showing the static mockup instead of the React app.

---

## `src-tauri/tauri.conf.json` — MODIFIED

| Setting | Before | After | Why |
|---|---|---|---|
| `title` | `"easyffmpeg"` | `"EasyFFmpeg"` | Proper capitalisation in the OS title bar |
| `width` | `800` | `960` | Matches the designed layout |
| `height` | `600` | `660` | Matches the designed layout |
| `minWidth` | *(not set)* | `760` | Prevents layout breaking when resizing |
| `minHeight` | *(not set)* | `520` | Prevents layout breaking when resizing |
| `beforeDevCommand` | `"pnpm dev"` | `"npm run dev"` | pnpm is not installed on this machine |
| `beforeBuildCommand` | `"pnpm build"` | `"npm run build"` | Same reason |

---

## `src-tauri/src/lib.rs` — FULL REWRITE

### What was removed
- `greet()` — hello-world demo command, not used
- `convert_filetype()` — blocked until FFmpeg finished with no progress, no cancel

### What was added / changed

#### `probe_file(path) -> f64`
Calls `ffprobe` to get the file's duration in seconds before conversion starts.
Needed so the progress bar can calculate a real percentage (current time ÷ total duration).

#### `convert_file(id, input, output, duration, options) -> Result`
Replaces the old `convert_filetype`. Key differences:
- Passes `-progress -` to FFmpeg so it writes machine-readable progress lines to stdout
- Reads those lines one by one and emits `"conversion-progress"` events to the frontend
- Stderr is read on a separate thread so its buffer never fills up and blocks FFmpeg
- Accepts a full `ConvertOptions` struct for quality, codec, resolution, trim times
- Adds `-vn` flag automatically when `audio_only: true` (required for MP3/AAC/FLAC output)
- Stores the process PID in `JobStore` so it can be cancelled

#### `cancel_conversion(id)`
Looks up the PID for a job ID and kills the FFmpeg process.
- Windows: `taskkill /F /PID <pid>`
- macOS/Linux: `kill -9 <pid>`

#### `reveal_in_folder(path)`
Gets the parent directory of the output file and opens it in the OS file manager.
- Windows: `explorer <folder>`
- macOS: `open <folder>`
- Linux: `xdg-open <folder>`

#### `check_ffmpeg() -> bool`
Runs `ffmpeg -version` silently. Returns `true` if FFmpeg is on the system PATH.
Called on startup by the frontend to decide whether to show the install banner.

#### `open_ffmpeg_install()`
Opens a terminal window with the appropriate install command for the current OS.
- Windows: opens PowerShell running `winget install Gyan.FFmpeg`
- macOS: opens Terminal.app running `brew install ffmpeg`
- Linux: opens `x-terminal-emulator` or `gnome-terminal` running `apt install ffmpeg`

#### Bug fix: double `invoke_handler!`
The old code called `.invoke_handler()` twice. In Tauri v2 the second call silently
replaces the first, so `greet` was unreachable. All commands now registered in one call.

#### `JobStore` state
`Mutex<HashMap<String, u32>>` — maps job IDs to PIDs. Registered with `.manage()`
so Tauri injects it into commands automatically. Required for cancel to work.

---

## `src/App.tsx` — FULL REWRITE

Replaced the basic tab-based prototype with a full React UI wired to the Rust backend.

### State
| State var | Purpose |
|---|---|
| `queue` | List of files with their conversion state, percent, error, output path |
| `preset` | Which sidebar preset is selected |
| `settings` | Format, quality, resolution, codecs, trim times |
| `showAdvanced` | Whether the advanced settings row is visible |
| `dragOver` | Whether files are being dragged over the window |
| `converting` | Prevents double-clicking Convert |
| `ffmpegOk` | Result of `check_ffmpeg` — controls the install banner |

### Wired-up features
- **Drag-and-drop** via Tauri's `onDragDropEvent` (gives real file system paths)
- **Add Files button** via `open()` from `@tauri-apps/plugin-dialog`
- **File probing** — calls `probe_file` on every added file to get duration
- **Convert** — calls `convert_file` for each queued item sequentially
- **Progress** — listens to `"conversion-progress"` events, updates progress bars in real time
- **Reveal in Finder** — calls `reveal_in_folder` with the output path
- **Cancel** — calls `cancel_conversion` and resets item to queued state
- **Retry** — resets an errored item to queued state
- **FFmpeg banner** — shown if `check_ffmpeg()` returns false; "Install FFmpeg" button
  calls `open_ffmpeg_install()`, "Check again" re-runs the check

### Audio format bug fix
When converting to an audio-only format (MP3, AAC, FLAC, WAV):
- `audioOnly: true` is passed → Rust adds `-vn` to strip the video stream
- The correct FFmpeg codec is selected automatically:

  | Output format | FFmpeg codec |
  |---|---|
  | `.mp3` | `libmp3lame` |
  | `.aac` | `aac` |
  | `.flac` | `flac` |
  | `.wav` | `pcm_s16le` |
  | `.opus` | `libopus` |

### Design
- Dark theme: `#1C1C1E` background, `#2C2C2E` surface
- Accent: orange `#F76B15`
- System-native font stack
- Six states per file row: queued, converting, done, error (+ sidebar and empty state)
- Animated progress bar from real FFmpeg data
- Slide-in FFmpeg missing banner

---

## `src/App.css` — FULL REWRITE

Replaced the old Tauri template CSS with a complete design system.

### Design tokens (CSS variables)
```css
--bg:             #1C1C1E   /* main window background */
--surface:        #2C2C2E   /* sidebar, settings strip */
--surface-raised: #3A3A3C   /* hover states, chips */
--accent:         #F76B15   /* orange — buttons, active preset, progress */
--destructive:    #FF453A   /* error states */
--text-primary:   #F2F2F7
--text-secondary: #8E8E93
```

### Key sections
- Sidebar with preset items, active state, section dividers
- Empty dropzone with drag-over highlight
- Queue view with compact top bar
- File rows with per-state styling (error tint, done border)
- Progress track (3px bar, transitions smoothly)
- Settings strip with selects, advanced row, footer
- Primary Convert button with hover/press/disabled states
- FFmpeg missing banner (amber, slides in from top)

---

## Files NOT changed
- `src/main.tsx` — already correct, renders `<App />`
- `src-tauri/Cargo.toml` — no new Rust dependencies needed
- `src-tauri/capabilities/default.json` — `core:default` already covers all app commands
- `src-tauri/build.rs` — untouched
- `src-tauri/src/main.rs` — untouched (just calls `lib::run()`)
- `package.json` — untouched
- `vite.config.ts` — untouched

---

## What still needs FFmpeg on PATH

The app calls `ffmpeg` and `ffprobe` by name. Users must have FFmpeg installed and
accessible from the command line. The in-app "Install FFmpeg" button handles this
automatically via `winget` on Windows.

To verify FFmpeg is installed: open a terminal and run `ffmpeg -version`.
