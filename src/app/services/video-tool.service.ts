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

  concatClips(clipDir: string, outputFile: string): Promise<void> {
    return invoke<void>("concat_clips", { clipDir, outputFile });
  }

  processVideo(args: {
    inputFile: string;
    outputFile: string;
    startTime: string | null;
    endTime: string | null;
    mute: boolean;
    reEncode: boolean;
    hwAcceleration: boolean;
  }): Promise<void> {
    return invoke<void>("process_video", args);
  }

  /** Converts a local filesystem path into a URL the webview can load. */
  toPreviewUrl(path: string): string {
    return convertFileSrc(path);
  }
}
