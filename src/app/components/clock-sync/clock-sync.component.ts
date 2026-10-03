import { Component, computed, effect, input, output, signal } from "@angular/core";
import { formatHms } from "../../models";
import { TimeInputComponent } from "../time-input/time-input.component";

const OPEN_KEY = "clockSync.open";
const BUFFER_KEY = "clockSync.bufferSecs";
const DEFAULT_BUFFER_SECS = 5;

/** A moment known both by race-clock time and by position in the video. */
export interface ClockReference {
  clockSecs: number;
  videoSecs: number;
}

/** Where `clockSecs` falls in the video, or null if it's outside it. */
export function clockToVideo(
  ref: ClockReference,
  clockSecs: number,
  durationSecs: number,
): number | null {
  const secs = ref.videoSecs + (clockSecs - ref.clockSecs);
  return secs >= 0 && secs <= durationSecs ? secs : null;
}

/** The race time at `videoSecs`; negative before the race clock's zero. */
export function videoToClock(ref: ClockReference, videoSecs: number): number {
  return ref.clockSecs + (videoSecs - ref.videoSecs);
}

/**
 * What to enter on a results site that syncs video to finish times: the
 * uploaded video's length, and its offset — the race time at its first frame,
 * which the site subtracts from a finish time to find that runner. Adding the
 * buffer to the offset makes every runner play `bufferSecs` early, so viewers
 * see them coming in rather than starting on the line.
 */
export function onlineSyncValues(
  ref: ClockReference,
  trimStartSecs: number,
  trimEndSecs: number,
  bufferSecs: number,
): { lengthSecs: number; firstFrameRaceSecs: number; offsetSecs: number } {
  const firstFrameRaceSecs = Math.round(videoToClock(ref, trimStartSecs));
  return {
    lengthSecs: Math.max(0, Math.floor(trimEndSecs - trimStartSecs)),
    firstFrameRaceSecs,
    offsetSecs: firstFrameRaceSecs + bufferSecs,
  };
}

/** Like formatHms, but keeps the sign (tapes often start before the gun). */
export function formatSignedHms(secs: number): string {
  return secs < 0 ? `-${formatHms(-secs)}` : formatHms(secs);
}

/**
 * Optional helper for finding runners by their race time. The user syncs once
 * by entering the race time of whatever frame is on screen (the start of the
 * tape, or the first finisher crossing), then types any finish time from the
 * results to jump straight to it. Trimming is left to the preview's
 * "Set to playhead" controls, so the user can fine-tune the spot first.
 * Collapses to one line when not in use.
 */
@Component({
  selector: "app-clock-sync",
  standalone: true,
  imports: [TimeInputComponent],
  templateUrl: "./clock-sync.component.html",
  styleUrl: "./clock-sync.component.css",
})
export class ClockSyncComponent {
  readonly playheadSecs = input(0);
  readonly durationSecs = input(0);
  /** The part of the video Export will write. */
  readonly trimStartSecs = input(0);
  readonly trimEndSecs = input(0);
  readonly seek = output<number>();

  readonly formatHms = formatHms;
  readonly formatSignedHms = formatSignedHms;

  readonly open = signal(readStored(OPEN_KEY) === "true");
  readonly bufferSecs = signal(readBuffer());
  /** The race time being entered for the frame on screen. */
  readonly syncDraft = signal(0);
  readonly sync = signal<ClockReference | null>(null);
  /** Showing the sync step's entry form rather than its summary. */
  readonly editingSync = signal(true);
  readonly findClock = signal(0);
  private findEdited = false;

  readonly found = computed(() => {
    const sync = this.sync();
    return sync ? clockToVideo(sync, this.findClock(), this.durationSecs()) : null;
  });
  readonly playheadClock = computed(() => {
    const sync = this.sync();
    return sync ? videoToClock(sync, this.playheadSecs()) : null;
  });

  /** Race times at the very start and end of the video, for explaining a miss. */
  readonly videoRaceStart = computed(() => {
    const sync = this.sync();
    return sync ? videoToClock(sync, 0) : 0;
  });
  readonly videoRaceEnd = computed(() => {
    const sync = this.sync();
    return sync ? videoToClock(sync, this.durationSecs()) : 0;
  });

  readonly online = computed(() => {
    const sync = this.sync();
    return sync
      ? onlineSyncValues(sync, this.trimStartSecs(), this.trimEndSecs(), this.bufferSecs())
      : null;
  });
  /** Where the site will start the runner last searched for, in the uploaded
   * video; null if they aren't in it. */
  readonly examplePlayAt = computed(() => {
    const online = this.online();
    if (!online) return null;
    const crossesAt = this.findClock() - online.firstFrameRaceSecs;
    if (crossesAt < 0 || crossesAt > online.lengthSecs) return null;
    return this.findClock() - online.offsetSecs;
  });

  constructor() {
    effect(() => {
      const open = this.open();
      try {
        localStorage.setItem(OPEN_KEY, String(open));
        localStorage.setItem(BUFFER_KEY, String(this.bufferSecs()));
      } catch {
        // Storage unavailable; the panel just won't remember its settings.
      }
    });
  }

  toggle(): void {
    this.open.update((o) => !o);
  }

  /** Ties the race time entered to the frame on screen. */
  syncToPlayhead(): void {
    this.sync.set({ clockSecs: this.syncDraft(), videoSecs: this.playheadSecs() });
    this.editingSync.set(false);
    // Finishers are usually close to the sync point, so start the search
    // there and only the digits that differ need typing.
    if (!this.findEdited) this.findClock.set(this.syncDraft());
  }

  changeSync(): void {
    const sync = this.sync();
    // Offer the race time of the current frame, which is what's most likely
    // being corrected.
    if (sync) {
      const here = Math.floor(videoToClock(sync, this.playheadSecs()));
      this.syncDraft.set(Math.max(0, here));
    }
    this.editingSync.set(true);
  }

  cancelChangeSync(): void {
    this.editingSync.set(false);
  }

  setBuffer(raw: string): void {
    const secs = Math.round(Number(raw));
    this.bufferSecs.set(Number.isFinite(secs) ? Math.max(0, secs) : 0);
  }

  copy(value: number): void {
    navigator.clipboard?.writeText(String(value)).catch(() => {});
  }

  goToFound(): void {
    const found = this.found();
    if (found !== null) this.seek.emit(found);
  }

  /** Searching feels live: jump as soon as a typed time lands. */
  setFindClock(secs: number): void {
    this.findClock.set(secs);
    this.findEdited = true;
    const found = this.found();
    if (found !== null) this.seek.emit(found);
  }
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readBuffer(): number {
  const stored = Number(readStored(BUFFER_KEY) ?? NaN);
  return Number.isFinite(stored) && stored >= 0 ? stored : DEFAULT_BUFFER_SECS;
}
