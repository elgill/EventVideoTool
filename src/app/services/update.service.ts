import { Injectable, signal } from "@angular/core";
import { getVersion } from "@tauri-apps/api/app";
import { Update, check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "checkFailed"; message: string }
  | { kind: "dismissed"; version: string }
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
  /** The running app's version (from package.json via tauri.conf.json). */
  readonly currentVersion = signal<string | null>(null);

  private update: Update | null = null;

  /** Fails into a "checkFailed" state (e.g. offline) rather than throwing. */
  async checkForUpdate(): Promise<void> {
    if (this.currentVersion() === null) {
      this.currentVersion.set(await getVersion().catch(() => null));
    }
    this.state.set({ kind: "checking" });
    try {
      this.update = await check();
    } catch (err) {
      console.warn("Update check failed:", err);
      this.state.set({ kind: "checkFailed", message: String(err) });
      return;
    }
    this.state.set(
      this.update ? { kind: "available", version: this.update.version } : { kind: "upToDate" },
    );
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

  /** Hides the banner; a pending update stays installable from the header. */
  dismiss(): void {
    const state = this.state();
    if (state.kind === "available") {
      this.state.set({ kind: "dismissed", version: state.version });
    } else {
      this.state.set({ kind: "idle" });
    }
  }
}
