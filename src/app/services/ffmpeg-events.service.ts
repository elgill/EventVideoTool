import { Injectable, NgZone, signal } from "@angular/core";
import { listen } from "@tauri-apps/api/event";
import { FinishedEvent, ProgressEvent } from "../models";

/**
 * Listens for the `ffmpeg-progress`/`ffmpeg-finished` events emitted by
 * src-tauri/src/ffmpeg/runner.rs and exposes them as signals, replacing the
 * QThread pyqtSignal plumbing of the original app.
 */
@Injectable({ providedIn: "root" })
export class FfmpegEventsService {
  readonly progress = signal<ProgressEvent | null>(null);
  readonly lastFinished = signal<FinishedEvent | null>(null);
  readonly running = signal(false);

  private started = false;

  constructor(private readonly zone: NgZone) {}

  /** Idempotent: safe to call multiple times (e.g. from multiple components). */
  async ensureListening(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await listen<ProgressEvent>("ffmpeg-progress", (event) => {
      this.zone.run(() => {
        this.running.set(true);
        this.progress.set(event.payload);
      });
    });

    await listen<FinishedEvent>("ffmpeg-finished", (event) => {
      this.zone.run(() => {
        this.running.set(false);
        this.lastFinished.set(event.payload);
      });
    });
  }

  reset(): void {
    this.progress.set(null);
    this.lastFinished.set(null);
    this.running.set(true);
  }
}
