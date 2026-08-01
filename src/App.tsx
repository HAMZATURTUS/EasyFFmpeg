import { useState } from "react";
import { open } from '@tauri-apps/plugin-dialog';

import { invoke } from "@tauri-apps/api/core";
import { DragDropZone } from "./components/DragDropZone";
import "./App.css";
const AUDIO_FORMATS = new Set(['mp3', 'aac', 'flac', 'wav', 'opus', 'm4a']);

interface Settings {
  format: string;
  quality: string;
  resolution: string;
  videoCodec: string;
  audioCodec: string;
  trimStart: string;
  trimEnd: string;
  fileName: string;
  saveLocation: string;
}
interface MediaFile {
  id: string;
  path: string;
  name: string;
  duration: number;
  isAudio: boolean;
  fromFmt: string;
  state: 'queued' | 'converting' | 'done' | 'error';
  percent: number;
  error?: string;
}

function toStringDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00:00.000";

  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  
  const paddedHours = String(hours).padStart(2, '0');
  const paddedMins = String(mins).padStart(2, '0');
  const paddedSecs = String(secs).padStart(2, '0');
  const paddedMs = String(ms).padStart(3, '0');

  return `${paddedHours}:${paddedMins}:${paddedSecs}.${paddedMs}`;
}

function FileRow({ item, toFmt, onRemove, onCancel, onReveal, onRetry }: {
    item: MediaFile;
    toFmt: string;
    onRemove: () => void;
    onRetry: () => void;
    onCancel: () => void;
    onReveal: () => void;
  }) {
  //const isAudio = AUDIO_FORMATS.has(item.fromFmt.toLowerCase());
  const isAudio = item.isAudio;

  return (
    <div className={`file-row state-${item.state}`}>
      <div className={`thumb ${isAudio ? 't-audio' : 't-video'}`}>
        {isAudio ? <IcAudio /> : <IcVideo />}
      </div>

      <div className="file-info">
        <div className="file-name-row">
          <span className="file-name" title={item.name}>{item.name}</span>
          <span className="file-name" title={String(item.duration)}>Duration: {toStringDuration(item.duration)}</span>
          <div className="status-container">
            <div className="fmt-indicator">
              <span className="fmt-tag">{item.fromFmt}</span>
              <IcArrow />
              <span className="fmt-tag to">{toFmt}</span>
            </div>
            <StatusBadge state={item.state} />
          </div>
        </div>

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

function getFileName(path: string): string {
  return path.substring(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

function getFileExt(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot > -1 ? path.substring(dot + 1).toUpperCase() : '???';
}

function getFileNameNoExt(path: string): string {
  const fileName = path.substring(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0) {
    return fileName;
  }
  return fileName.substring(0, dotIndex);
}

export default function App() {

  const [activeFile, setActiveFile] = useState<MediaFile | null>(null);
  const [settings, setSettings] = useState<Settings>({
    format: 'mp4', quality: '', resolution: '',
    videoCodec: '', audioCodec: '', trimStart: '', trimEnd: '', fileName: 'out', saveLocation: '/',
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function handleSelectSaveLocation() {
    const folder = await open({
      multiple: false,
      directory: true,
    });
    if (folder && typeof folder == "string"){
      if (folder[folder.length - 1] != "/")
        setSettings(s => ({...s, saveLocation: folder + "/"}));
      else 
        setSettings(s => ({...s, saveLocation: folder}));
    }
  }

  async function selectFile() {
    const file = await open({
      multiple: false,
      directory: false,
    });

    if (file)
      handleFileLoaded(file);
  };

  const retryFile = () => {
    startConvert();
  }
  
  const removeFile = () => {
    setActiveFile(null);
  };

  const cancelFile = async () => {
    await invoke('cancel_conversion', {});
    setActiveFile(prev => prev ? { ...prev, state: 'queued', percent: 0 } : null);
  };

  const revealFile = (outputPath: string) => {
    console.log(outputPath);
    invoke('reveal_in_folder', { path: outputPath });
  }

  const handleFileLoaded = async (path: string) => {
    var duration;
    try {
      duration = await invoke<number>('probe_file', { path });
    } 
    catch (e) {
      console.log("failed to get duration, invalid file maybe?");
      return;
    }
    setActiveFile({ 
      id: "preview", 
      path: path, 
      name: getFileName(path), 
      state: 'queued', 
      duration: duration,
      isAudio: AUDIO_FORMATS.has(getFileExt(path).toLowerCase()),
      fromFmt: getFileExt(path), 
      percent: 0 
    });

    setSettings({
      format: activeFile?.isAudio ? 'mp3' : 'mp4', quality: '', resolution: '',
      videoCodec: '', audioCodec: '', trimStart: '', trimEnd: '', fileName: getFileNameNoExt(path), saveLocation: '/',
    });
  };

  const startConvert = async () => {
    setActiveFile(prev => prev ? { ...prev, state: 'converting', percent: 0 } : null);
    var display = document.getElementById('status-display') as HTMLLabelElement;
    display.textContent = "Conversion in progress";
    if (activeFile && settings){
      var out = settings.saveLocation + settings.fileName + "." + settings.format;
      console.log(out);
      try {
        await invoke ('convert_file', {
          inputPath: activeFile.path,
          outputPath: out,
          duration: activeFile.duration,
          trimStart: settings.trimStart,
          trimEnd: settings.trimEnd,
          quality: settings.quality,
          videoCodec: settings.videoCodec,
          audioCodec: settings.audioCodec
        });
        display.textContent = "";
        setActiveFile(prev => prev ? { ...prev, state: 'done', percent: 0 } : null);
      }
      catch (e) {
        display.textContent = "Error occurred, check console";
        console.log (e);
        setActiveFile(prev => prev ? { ...prev, state: 'error', percent: 0 } : null);
        return;
      }
    }
    else {
      setActiveFile(prev => prev ? { ...prev, state: 'queued', percent: 0 } : null);
      display.textContent = "Please fill all fields";
      return;
    }
  };

  // ── Render ──
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="app-body">

        {/* ── Main pane ── */}
        <main className="main-pane">
          {!activeFile ? (
            /* Empty state */
            <div className="empty-view">
              <h1>EasyFFmpeg</h1>
              <div className={`dropzone${dragOver ? ' drag-over' : ''}`}>
                <DragDropZone onFileSelected={handleFileLoaded}
                              onHoverChange={setDragOver}>
                  <IcUpload className="dz-icon" />
                  <div className="dz-headline">Drop a file here</div>
                  <div className="dz-sub">
                    Drag any video or audio file into this window.<br />
                    EasyFFmpeg handles the rest.
                  </div>
                  <div className="dz-formats">
                    {['MP4', 'MOV', 'MKV', 'AVI', 'MP3', 'WAV', 'FLAC', 'OPUS', 'WebM', '+ more'].map(f => (
                      <span key={f} className="fmt-chip">{f}</span>
                    ))}
                  </div>
                  <button className="btn-add-files" onClick={selectFile}>
                    <IcPlus size={14} /> Add Files
                  </button>
                </DragDropZone>
              </div>
            </div>

          ) : (

            /* Queue view */
            <div className="queue-view">

              {/* Compact top drop bar */}

              {/* File list */}
              <div className="queue-list">
                {activeFile && (
                  <FileRow
                    key={activeFile.id}
                    item={activeFile}
                    toFmt={settings.format.toUpperCase()}
                    onRemove={() => removeFile()}
                    onRetry={() => retryFile()}
                    onCancel={() => cancelFile()}
                    onReveal={() => settings.saveLocation && revealFile(settings.saveLocation)}
                />
                )}
              </div>

              {/* Settings strip */}
              <div className="settings-strip">
                <div className="settings-row">

                  <div className="setting-group">
                    <label className="setting-label" htmlFor="fmt-sel">Format</label>
                    <select id="fmt-sel" className="s-select"
                      value={settings.format}
                      onChange={e => setSettings(s => ({ ...s, format: e.target.value }))}>
                      {(activeFile.isAudio 
                        ? ['mp3', 'aac', 'flac', 'wav'] 
                        : ['mp4', 'mov', 'webm', 'mkv', 'mp3', 'aac', 'flac', 'wav', 'gif']
                      ).map(f => (
                        <option key={f} value={f}>{f.toUpperCase()}</option>
                      ))}
                    </select>
                  </div>

                  <div className="setting-group">
                    <label className="setting-label" htmlFor="qual-sel">Quality</label>
                    <select id="qual-sel" className="s-select"
                      value={settings.quality}
                      onChange={e => setSettings(s => ({ ...s, quality: e.target.value }))}>
                      <option value="">Original</option>
                      <option value="high">High (visually lossless)</option>
                      <option value="balanced">Balanced</option>
                      <option value="small">Smaller file</option>
                    </select>
                  </div>
                  {!activeFile.isAudio && (
                  <div className="setting-group">
                    <label className="setting-label" htmlFor="res-sel">Resolution</label>
                    <select id="res-sel" className="s-select"
                      value={settings.resolution}
                      onChange={e => setSettings(s => ({ ...s, resolution: e.target.value }))}>
                      <option value="">Original</option>
                      <option value="2160p">4K</option>
                      <option value="1080p">1080p</option>
                      <option value="720p">720p</option>
                      <option value="480p">480p</option>
                    </select>
                  </div>
                  )}

                  <div className="setting-group">
                    <label className="setting-label" htmlFor="res-sel">Save Location</label>
                    <input readOnly id="save-location" className="s-input"
                    value={settings.saveLocation || "Default Folder"}
                    onClick={handleSelectSaveLocation}
                    title={settings.saveLocation}
                    style={{width: "20vw"}}/>
                  </div>

                  <div className="setting-group">
                    <label className="setting-label" htmlFor="res-sel">File Name</label>
                    <input id="file-name" className="s-input"
                    value={settings.fileName || "Default Folder"}
                    title={settings.fileName}
                    onChange={e => setSettings(s => ({ ...s, fileName: e.target.value }))}
                    style={{width: "20vw"}}/>
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
                    {!activeFile.isAudio && (
                    <div className="setting-group">
                      <label className="setting-label" htmlFor="codec-sel">Video Codec</label>
                      <select id="codec-sel" className="s-select"
                        value={settings.videoCodec}
                        onChange={e => setSettings(s => ({ ...s, videoCodec: e.target.value }))}>
                        <option value="">Original</option>
                        <option value="libx264">H.264 (libx264)</option>
                        <option value="libx265">H.265 (libx265)</option>
                        <option value="libvpx-vp9">VP9 (libvpx-vp9)</option>
                        <option value="libaom-av1">AV1 (libaom)</option>
                        <option value="prores_ks">ProRes 422</option>
                      </select>
                    </div>
                    )}
                    <div className="setting-group">
                      <label className="setting-label" htmlFor="trim-s">Trim Start</label>
                      <input id="trim-s" className="s-input" type="text" placeholder="HH:MM:SS.mmm"
                        value={settings.trimStart}
                        onChange={e => setSettings(s => ({ ...s, trimStart: e.target.value }))} />
                    </div>
                    <div className="setting-group">
                      <label className="setting-label" htmlFor="trim-e">Trim End</label>
                      <input id="trim-e" className="s-input" type="text" placeholder="HH:MM:SS.mmm"
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
                        <option value="">Copy (no re-encode)</option>
                      </select>
                    </div>
                  </div>
                )}

                <div className="settings-footer">
                  <button className="btn-primary" id="convert-btn"
                    disabled={activeFile.state == 'converting' || !activeFile}
                    onClick={startConvert}>
                    <IcPlay /> {activeFile.state == 'converting' ? "Converting..." : "Convert"}
                  </button>
                  <label className="setting-label" id="status-display"
                  style={{color: "red"}}
                  >
                  </label>
                </div>
              </div>

            </div>
          )}
        </main>
      </div>
    </div>
  );
}


function StatusBadge({ state }: { state: MediaFile['state'] }) {
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
