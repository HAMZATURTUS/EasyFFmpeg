import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import './App.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueItem {
  id: string;
  path: string;
  name: string;
  fromFmt: string;
  duration: number; // seconds, 0 if unknown
  state: 'queued' | 'converting' | 'done' | 'error';
  percent: number;
  error?: string;
  outputPath?: string;
}

interface Settings {
  format: string;
  quality: string;
  resolution: string;
  videoCodec: string;
  audioCodec: string;
  trimStart: string;
  trimEnd: string;
}

interface ConvertOptions {
  audioOnly: boolean;
  crf: number | null;
  scale: string | null;
  trimStart: string | null;
  trimEnd: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESETS = [
  { id: 'mp4-h264', label: 'MP4 — H.264',  format: 'mp4',  codec: 'libx264',    section: 'Video' },
  { id: 'mp4-h265', label: 'MP4 — H.265',  format: 'mp4',  codec: 'libx265',    section: 'Video', badge: '4K' },
  { id: 'webm-vp9', label: 'WebM — VP9',   format: 'webm', codec: 'libvpx-vp9', section: 'Video' },
  { id: 'prores',   label: 'ProRes 422',   format: 'mov',  codec: 'prores_ks',  section: 'Video', badge: 'Pro' },
  { id: 'mkv-av1',  label: 'MKV — AV1',    format: 'mkv',  codec: 'libaom-av1', section: 'Video', badge: 'New' },
  { id: 'mp3',      label: 'MP3',          format: 'mp3',  codec: null,         section: 'Audio' },
  { id: 'aac',      label: 'AAC',          format: 'aac',  codec: null,         section: 'Audio' },
  { id: 'flac',     label: 'FLAC',         format: 'flac', codec: null,         section: 'Audio', badge: 'LL' },
  { id: 'gif',      label: 'GIF',          format: 'gif',  codec: null,         section: 'Other' },
] as const;

const QUALITY_CRF: Record<string, number | undefined> = {
  high: 18, balanced: 23, small: 28,
};

const SCALE_MAP: Record<string, string | undefined> = {
  '2160p': '-2:2160', '1080p': '-2:1080', '720p': '-2:720', '480p': '-2:480',
};

const AUDIO_FORMATS = new Set(['mp3', 'aac', 'flac', 'wav', 'opus', 'm4a']);

// Maps output format to the correct FFmpeg audio codec name
const FORMAT_AUDIO_CODEC: Record<string, string> = {
  'mp3':  'libmp3lame',
  'aac':  'aac',
  'flac': 'flac',
  'wav':  'pcm_s16le',
  'opus': 'libopus',
  'm4a':  'aac',
};

// ─── Utilities ────────────────────────────────────────────────────────────────

let _id = 0;
const genId = () => String(++_id);

function getFileName(path: string): string {
  return path.substring(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

function getFileExt(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot > -1 ? path.substring(dot + 1).toUpperCase() : '???';
}

function getOutputPath(inputPath: string, format: string): string {
  const lastSep = Math.max(inputPath.lastIndexOf('/'), inputPath.lastIndexOf('\\'));
  const dir = inputPath.substring(0, lastSep + 1);
  const filename = inputPath.substring(lastSep + 1);
  const dotIdx = filename.lastIndexOf('.');
  const nameNoExt = dotIdx > -1 ? filename.substring(0, dotIdx) : filename;
  const srcExt = dotIdx > -1 ? filename.substring(dotIdx + 1).toLowerCase() : '';
  // Append _converted if input and output extension would be identical
  const suffix = srcExt === format.toLowerCase() ? '_converted' : '';
  return `${dir}${nameNoExt}${suffix}.${format}`;
}

function fmtDuration(secs: number): string {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [queue, setQueue]             = useState<QueueItem[]>([]);
  const [preset, setPreset]           = useState('mp4-h264');
  const [settings, setSettings]       = useState<Settings>({
    format: 'mp4', quality: 'balanced', resolution: 'original',
    videoCodec: 'libx264', audioCodec: 'aac', trimStart: '', trimEnd: '',
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dragOver, setDragOver]         = useState(false);
  const [converting, setConverting]     = useState(false);
  const [ffmpegOk, setFfmpegOk]         = useState<boolean | null>(null); // null = checking

  // Check FFmpeg on startup and whenever the user asks us to re-check
  const checkFfmpeg = useCallback(async () => {
    const ok = await invoke<boolean>('check_ffmpeg');
    setFfmpegOk(ok);
  }, []);

  useEffect(() => { checkFfmpeg(); }, [checkFfmpeg]);

  // Listen for progress events emitted by the Rust backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ id: string; percent: number }>('conversion-progress', (e) => {
      setQueue(q => q.map(item =>
        item.id === e.payload.id ? { ...item, percent: e.payload.percent } : item
      ));
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // Listen for files dragged onto the window (Tauri native drag-drop)
  const addPaths = useCallback(async (paths: string[]) => {
    for (const path of paths) {
      let duration = 0;
      try { duration = await invoke<number>('probe_file', { path }); } catch {}
      setQueue(q => [...q, {
        id: genId(), path,
        name: getFileName(path),
        fromFmt: getFileExt(path),
        duration, state: 'queued', percent: 0,
      }]);
    }
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebviewWindow().onDragDropEvent((e) => {
      if (e.payload.type === 'hover')  { setDragOver(true); }
      else if (e.payload.type === 'leave') { setDragOver(false); }
      else if (e.payload.type === 'drop')  { setDragOver(false); addPaths(e.payload.paths); }
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [addPaths]);

  // ── File actions ──

  const openDialog = async () => {
    const files = await open({ multiple: true, directory: false });
    if (!files) return;
    await addPaths(Array.isArray(files) ? files : [files]);
  };

  const removeFile = (id: string) =>
    setQueue(q => q.filter(item => item.id !== id));

  const retryFile = (id: string) =>
    setQueue(q => q.map(item =>
      item.id === id ? { ...item, state: 'queued', percent: 0, error: undefined } : item
    ));

  const cancelFile = async (id: string) => {
    await invoke('cancel_conversion', { id });
    setQueue(q => q.map(item =>
      item.id === id ? { ...item, state: 'queued', percent: 0 } : item
    ));
  };

  const revealFile = (outputPath: string) =>
    invoke('reveal_in_folder', { path: outputPath });

  // ── Conversion ──

  const startConvert = async () => {
    const toConvert = queue.filter(i => i.state === 'queued');
    if (!toConvert.length) return;
    setConverting(true);

    const isAudio = AUDIO_FORMATS.has(settings.format.toLowerCase());
    // Pick the right audio codec for the output format (e.g. libmp3lame for mp3)
    const audioCodec = isAudio
      ? (FORMAT_AUDIO_CODEC[settings.format] ?? settings.audioCodec)
      : settings.audioCodec;

    for (const item of toConvert) {
      const outputPath = getOutputPath(item.path, settings.format);

      const options: ConvertOptions = {
        audioOnly:  isAudio,
        crf:        !isAudio ? (QUALITY_CRF[settings.quality] ?? null) : null,
        scale:      !isAudio ? (SCALE_MAP[settings.resolution] ?? null) : null,
        trimStart:  settings.trimStart.trim() || null,
        trimEnd:    settings.trimEnd.trim() || null,
        videoCodec: !isAudio ? settings.videoCodec : null,
        audioCodec: audioCodec || null,
      };

      setQueue(q => q.map(i => i.id === item.id ? { ...i, state: 'converting' } : i));

      try {
        await invoke('convert_file', {
          id: item.id, input: item.path, output: outputPath,
          duration: item.duration, options,
        });
        setQueue(q => q.map(i => i.id === item.id
          ? { ...i, state: 'done', percent: 100, outputPath } : i));
      } catch (e) {
        setQueue(q => q.map(i => i.id === item.id
          ? { ...i, state: 'error', error: String(e) } : i));
      }
    }

    setConverting(false);
  };

  // ── Sidebar preset selection ──

  const selectPreset = (p: typeof PRESETS[number]) => {
    setPreset(p.id);
    setSettings(s => ({ ...s, format: p.format, videoCodec: p.codec ?? s.videoCodec }));
  };

  // ── Derived state ──

  const convCount   = queue.filter(i => i.state === 'converting').length;
  const doneCount   = queue.filter(i => i.state === 'done').length;
  const errCount    = queue.filter(i => i.state === 'error').length;
  const queuedCount = queue.filter(i => i.state === 'queued').length;

  const countText = (() => {
    if (!queue.length) return '';
    if (convCount)            return `Converting ${convCount} of ${queue.length} file${queue.length > 1 ? 's' : ''}…`;
    if (doneCount === queue.length) return `All ${queue.length} file${queue.length > 1 ? 's' : ''} converted`;
    if (errCount)             return `${doneCount} done · ${errCount} error${errCount > 1 ? 's' : ''} · ${queuedCount} queued`;
    return `${queue.length} file${queue.length > 1 ? 's' : ''} queued`;
  })();

  const sections = ['Video', 'Audio', 'Other'] as const;

  // ── Render ──

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {ffmpegOk === false && (
        <FfmpegBanner onInstall={() => invoke('open_ffmpeg_install')} onRecheck={checkFfmpeg} />
      )}
      <div className="app-body">

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        {sections.map(section => (
          <div key={section}>
            <div className="sidebar-label">{section}</div>
            {PRESETS.filter(p => p.section === section).map(p => (
              <button
                key={p.id}
                className={`preset-item${preset === p.id ? ' active' : ''}`}
                onClick={() => selectPreset(p)}
              >
                {section === 'Video' && <IcVideo />}
                {section === 'Audio' && <IcAudio />}
                {section === 'Other' && <IcImage />}
                <span>{p.label}</span>
                {'badge' in p && <span className="preset-badge">{p.badge}</span>}
              </button>
            ))}
            {section !== 'Other' && <div className="sidebar-divider" />}
          </div>
        ))}
      </aside>

      {/* ── Main pane ── */}
      <main className="main-pane">
        {queue.length === 0 ? (

          /* Empty state */
          <div className="empty-view">
            <div className={`dropzone${dragOver ? ' drag-over' : ''}`}>
              <IcUpload className="dz-icon" />
              <div className="dz-headline">Drop files here</div>
              <div className="dz-sub">
                Drag any video or audio file into this window.<br />
                EasyFFmpeg handles the rest.
              </div>
              <div className="dz-formats">
                {['MP4','MOV','MKV','AVI','MP3','WAV','FLAC','OPUS','WebM','+ more'].map(f => (
                  <span key={f} className="fmt-chip">{f}</span>
                ))}
              </div>
              <button className="btn-add-files" onClick={openDialog}>
                <IcPlus size={14} /> Add Files
              </button>
            </div>
          </div>

        ) : (

          /* Queue view */
          <div className="queue-view">

            {/* Compact top drop bar */}
            <div className="queue-topbar">
              <div className={`mini-drop${dragOver ? ' drag-over' : ''}`}>
                <IcUploadSm /> Drop more files here
              </div>
              <button className="btn-topbar-add" onClick={openDialog}>
                <IcPlus size={13} /> Add Files
              </button>
            </div>

            {/* File list */}
            <div className="queue-list">
              {queue.map(item => (
                <FileRow
                  key={item.id}
                  item={item}
                  toFmt={settings.format.toUpperCase()}
                  onRemove={() => removeFile(item.id)}
                  onRetry={() => retryFile(item.id)}
                  onCancel={() => cancelFile(item.id)}
                  onReveal={() => item.outputPath && revealFile(item.outputPath)}
                />
              ))}
            </div>

            {/* Settings strip */}
            <div className="settings-strip">
              <div className="settings-row">

                <div className="setting-group">
                  <label className="setting-label" htmlFor="fmt-sel">Format</label>
                  <select id="fmt-sel" className="s-select"
                    value={settings.format}
                    onChange={e => setSettings(s => ({ ...s, format: e.target.value }))}>
                    {['mp4','mov','webm','mkv','mp3','aac','flac','gif'].map(f => (
                      <option key={f} value={f}>{f.toUpperCase()}</option>
                    ))}
                  </select>
                </div>

                <div className="setting-group">
                  <label className="setting-label" htmlFor="qual-sel">Quality</label>
                  <select id="qual-sel" className="s-select"
                    value={settings.quality}
                    onChange={e => setSettings(s => ({ ...s, quality: e.target.value }))}>
                    <option value="high">High (visually lossless)</option>
                    <option value="balanced">Balanced</option>
                    <option value="small">Smaller file</option>
                  </select>
                </div>

                <div className="setting-group">
                  <label className="setting-label" htmlFor="res-sel">Resolution</label>
                  <select id="res-sel" className="s-select"
                    value={settings.resolution}
                    onChange={e => setSettings(s => ({ ...s, resolution: e.target.value }))}>
                    <option value="original">Original</option>
                    <option value="2160p">4K — 2160p</option>
                    <option value="1080p">1080p</option>
                    <option value="720p">720p</option>
                    <option value="480p">480p</option>
                  </select>
                </div>

                <button
                  className={`more-opts-btn${showAdvanced ? ' open' : ''}`}
                  onClick={() => setShowAdvanced(v => !v)}
                  aria-expanded={showAdvanced}
                >
                  {showAdvanced ? 'Fewer options' : 'More options'} <IcChevron />
                </button>
              </div>

              {showAdvanced && (
                <div className="adv-row">
                  <div className="setting-group">
                    <label className="setting-label" htmlFor="codec-sel">Video Codec</label>
                    <select id="codec-sel" className="s-select"
                      value={settings.videoCodec}
                      onChange={e => setSettings(s => ({ ...s, videoCodec: e.target.value }))}>
                      <option value="libx264">H.264 (libx264)</option>
                      <option value="libx265">H.265 (libx265)</option>
                      <option value="libvpx-vp9">VP9 (libvpx-vp9)</option>
                      <option value="libaom-av1">AV1 (libaom)</option>
                      <option value="prores_ks">ProRes 422</option>
                    </select>
                  </div>
                  <div className="setting-group">
                    <label className="setting-label" htmlFor="trim-s">Trim Start</label>
                    <input id="trim-s" className="s-input" type="text" placeholder="0:00:00"
                      value={settings.trimStart}
                      onChange={e => setSettings(s => ({ ...s, trimStart: e.target.value }))} />
                  </div>
                  <div className="setting-group">
                    <label className="setting-label" htmlFor="trim-e">Trim End</label>
                    <input id="trim-e" className="s-input" type="text" placeholder="0:00:00"
                      value={settings.trimEnd}
                      onChange={e => setSettings(s => ({ ...s, trimEnd: e.target.value }))} />
                  </div>
                  <div className="setting-group">
                    <label className="setting-label" htmlFor="audio-sel">Audio</label>
                    <select id="audio-sel" className="s-select"
                      value={settings.audioCodec}
                      onChange={e => setSettings(s => ({ ...s, audioCodec: e.target.value }))}>
                      <option value="aac">AAC 192k</option>
                      <option value="mp3">MP3 320k</option>
                      <option value="copy">Copy (no re-encode)</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="settings-footer">
                <span className="queue-count">{countText}</span>
                <button className="btn-primary"
                  disabled={converting || !queuedCount}
                  onClick={startConvert}>
                  <IcPlay /> Convert
                </button>
              </div>
            </div>

          </div>
        )}
      </main>
      </div>
    </div>
  );
}

// ─── FFmpeg Banner ────────────────────────────────────────────────────────────

function FfmpegBanner({ onInstall, onRecheck }: { onInstall: () => void; onRecheck: () => void }) {
  const [installing, setInstalling] = useState(false);

  const handleInstall = async () => {
    setInstalling(true);
    await onInstall();
    // Give a moment before re-enabling so the user sees something happened
    setTimeout(() => setInstalling(false), 2000);
  };

  return (
    <div className="ffmpeg-banner">
      <span className="ffmpeg-banner-icon">⚠</span>
      <div className="ffmpeg-banner-text">
        <strong>FFmpeg not found</strong>
        <span>Install FFmpeg to enable conversion. It takes about 1 minute.</span>
      </div>
      <button
        className="ffmpeg-banner-btn install"
        onClick={handleInstall}
        disabled={installing}
      >
        {installing ? 'Opening installer…' : '⬇ Install FFmpeg'}
      </button>
      <button className="ffmpeg-banner-btn recheck" onClick={onRecheck}>
        Check again
      </button>
    </div>
  );
}

// ─── FileRow ──────────────────────────────────────────────────────────────────

function FileRow({ item, toFmt, onRemove, onRetry, onCancel, onReveal }: {
  item: QueueItem;
  toFmt: string;
  onRemove: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onReveal: () => void;
}) {
  const isAudio = AUDIO_FORMATS.has(item.fromFmt.toLowerCase());

  return (
    <div className={`file-row state-${item.state}`}>
      <div className={`thumb ${isAudio ? 't-audio' : 't-video'}`}>
        {isAudio ? <IcAudio /> : <IcVideo />}
      </div>

      <div className="file-info">
        <div className="file-name-row">
          <span className="file-name" title={item.name}>{item.name}</span>
          <div className="fmt-indicator">
            <span className="fmt-tag">{item.fromFmt}</span>
            <IcArrow />
            <span className="fmt-tag to">{toFmt}</span>
          </div>
          <StatusBadge state={item.state} />
        </div>

        {item.duration > 0 && (
          <div className="file-meta">{fmtDuration(item.duration)}</div>
        )}

        <div className="prog-track">
          <div
            className={`prog-fill${item.state === 'error' ? ' c-error' : ''}`}
            style={{ width: `${item.state === 'error' ? 100 : item.percent}%` }}
          />
        </div>

        {item.state === 'error' && item.error && (
          <>
            <div className="error-msg">{item.error}</div>
            <div className="error-fix">
              Check that FFmpeg is installed on your system and the file is a valid media file.
            </div>
          </>
        )}
      </div>

      <div className="file-actions">
        {item.state === 'done' && (
          <>
            <button className="pill-btn reveal" onClick={onReveal}>
              <IcFolder /> Reveal in Finder
            </button>
            <button className="icon-btn danger" onClick={onRemove} title="Remove"><IcTrash /></button>
          </>
        )}
        {item.state === 'error' && (
          <>
            <button className="pill-btn retry" onClick={onRetry}><IcRetry /> Retry</button>
            <button className="icon-btn danger" onClick={onRemove} title="Remove"><IcTrash /></button>
          </>
        )}
        {item.state === 'converting' && (
          <button className="icon-btn" onClick={onCancel} title="Cancel"><IcCancel /></button>
        )}
        {item.state === 'queued' && (
          <button className="icon-btn danger" onClick={onRemove} title="Remove"><IcTrash /></button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ state }: { state: QueueItem['state'] }) {
  if (state === 'queued')     return <span className="badge queued">Queued</span>;
  if (state === 'converting') return <span className="badge converting"><span className="conv-dot"/>Converting</span>;
  if (state === 'done')       return <span className="badge done">Done</span>;
  if (state === 'error')      return <span className="badge error">Error</span>;
  return null;
}

// ─── Icons (inline SVG, Lucide style) ─────────────────────────────────────────

function IcVideo() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="14" height="16" rx="2"/><path d="M16 8.5l5.5-3.5v14L16 15.5"/></svg>;
}
function IcAudio() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>;
}
function IcImage() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>;
}
function IcUpload({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="15" width="38" height="29" rx="4"/><path d="M18 23l8-9 8 9"/><line x1="26" y1="14" x2="26" y2="33"/><path d="M16 41h20"/></svg>;
}
function IcUploadSm() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
}
function IcPlus({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
}
function IcArrow() {
  return <svg className="fmt-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>;
}
function IcTrash() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;
}
function IcFolder() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>;
}
function IcRetry() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6"/><path d="M3.5 15a9 9 0 1 0 .5-5"/></svg>;
}
function IcCancel() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
}
function IcPlay() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>;
}
function IcChevron() {
  return <svg className="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>;
}
