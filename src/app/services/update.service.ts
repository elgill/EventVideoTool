import { Injectable, signal } from "@angular/core";
import { Update, check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "available"; version: string }
  | { kind: "installing"; version: string; percentage: number | null }
  | { kind: "failed"; version: string; message: string };

/**
 * Checks the latest GitHub release's latest.json (endpoint and public key in
 * src-tauri/tauri.conf.json) and installs the signed installer it points at.
 */
@Injectable({ providedIn: "root" })
export class UpdateService {
  readonly state = signal<UpdateState>({ kind: "idle" });

  private update: Update | null = null;

  /** Quietly does nothing when offline or no release is published yet. */
  async checkForUpdate(): Promise<void> {
    try {
      this.update = await check();
    } catch (err) {
      console.warn("Update check failed:", err);
      return;
    }
    if (this.update) this.state.set({ kind: "available", version: this.update.version });
  }

  /** Downloads and installs the update, then restarts the app. */
  async install(): Promise<void> {
    const update = this.update;
    if (!update) return;
    const version = update.version;
    this.state.set({ kind: "installing", version, percentage: null });

    let total = 0;
    let downloaded = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const percentage = total > 0 ? Math.min(100, (downloaded / total) * 100) : null;
          this.state.set({ kind: "installing", version, percentage });
        }
      });
      // On Windows the installer exits the app itself; this covers other platforms.
      await relaunch();
    } catch (err) {
      this.state.set({ kind: "failed", version, message: String(err) });
    }
  }

  dismiss(): void {
    this.state.set({ kind: "idle" });
  }
}
