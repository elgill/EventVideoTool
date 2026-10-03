import { Injectable } from "@angular/core";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ClipInfo } from "../models";

/** Thin wrapper around the Tauri commands defined in src-tauri/src/commands.rs. */
@Injectable({ providedIn: "root" })
export class VideoToolService {
  async pickDirectory(): Promise<string | null> {
    const selection = await open({ directory: true, multiple: false });
    return typeof selection === "string" ? selection : null;
  }

  listClips(dir: string): Promise<ClipInfo[]> {
    return invoke<ClipInfo[]>("list_clips", { dir });
  }

  detectHwEncoder(): Promise<string | null> {
    return invoke<string | null>("detect_hw_encoder");
  }

  /** Concatenates, trims, mutes, and/or re-encodes `clips` into
   * `outputFile` in one pass. `startSecs`/`endSecs` are positions on the
   * combined timeline of `clips`; null means its start/end. */
  exportVideo(args: {
    clips: ClipInfo[];
    outputFile: string;
    startSecs: number | null;
    endSecs: number | null;
    mute: boolean;
    reEncode: boolean;
    hwAcceleration: boolean;
  }): Promise<void> {
    return invoke<void>("export_video", args);
  }

  /** Converts a local filesystem path into a URL the webview can load. */
  toPreviewUrl(path: string): string {
    return convertFileSrc(path);
  }
}
