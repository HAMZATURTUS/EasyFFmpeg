import { FC, useEffect } from "react";
import { useTauriFileDrop } from "../hooks/useTauriFileDrop.ts";
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

export type DragDropZoneProps = {
  title?: string;
  onFileSelected: (path: string) => void;
  onHoverChange?: (hovering: boolean) => void;
  children?: React.ReactNode;
};

function extractPaths(payload: unknown): string[] {
  if (Array.isArray(payload) && payload.every((p) => typeof p === "string")) {
    return payload as string[];
  }

  if (
    payload &&
    typeof payload === "object" &&
    "paths" in (payload as Record<string, unknown>) &&
    Array.isArray((payload as { paths: unknown }).paths)
  ) {
    const paths = (payload as { paths: unknown[] }).paths;
    return paths.filter((p): p is string => typeof p === "string");
  }

  return [];
}

export const DragDropZone: FC<DragDropZoneProps> = ({ title = "Drop files here", onFileSelected, onHoverChange, children }) => {
  const { files } = useTauriFileDrop();

  // Watch for when files are dropped into the hook
  useEffect(() => {
    if (files.length > 0 && files.length <= 1) {
        getCurrentWebviewWindow().onDragDropEvent((e) => {
        if (e.payload.type === 'enter')  { onHoverChange?.(true) }
        else if (e.payload.type === 'leave') { onHoverChange?.(false); }
        else if (e.payload.type === 'drop')  {
            onHoverChange?.(false);
            const paths = extractPaths(e.payload);
            if (paths.length) onFileSelected(paths[0]);
        }
    })
    }
  }, [files, onFileSelected]);

  return (
    
    <section className="dragdrop">
      <div className={`drop-area ${onHoverChange ? "hovering" : ""}`} style={{ width: "100%" }}>
        {children || (
          <>
            <p className="drop-title">{title}</p>
            <p className="drop-sub">Drag files from your OS into this window.</p>
          </>
        )}
      </div>
    </section>
  );
};