import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { formatHms } from "../../models";
import { TimeInputComponent } from "../time-input/time-input.component";
import { Timeline, locate } from "../../timeline";

export interface TrimRange {
  startSecs: number;
  endSecs: number;
}

type DragHandle = "start" | "end" | null;
type Slot = 0 | 1;

/** Shortest trim range the handles or typed times can make. */
const MIN_TRIM_SECS = 0.1;

/**
 * Plays a list of clips as if they were one video. Every time shown or
 * emitted is a position on the combined timeline.
 *
 * Two <video> elements take turns: the visible one plays the current clip
 * while the hidden one preloads the next, so crossing a clip boundary is a
 * swap rather than a fresh load (which would flash black).
 */
@Component({
  selector: "app-video-preview",
  standalone: true,
  imports: [TimeInputComponent],
  templateUrl: "./video-preview.component.html",
  styleUrl: "./video-preview.component.css",
})
export class VideoPreviewComponent {
  readonly timeline = input<Timeline>({ entries: [], totalSecs: 0 });
  /** Maps a clip path to a URL the webview can load. */
  readonly urlFor = input<(path: string) => string>((path) => path);
  readonly trimChange = output<TrimRange>();
  readonly currentClipChange = output<number>();

  readonly videoA = viewChild<ElementRef<HTMLVideoElement>>("videoA");
  readonly videoB = viewChild<ElementRef<HTMLVideoElement>>("videoB");
  readonly trackEl = viewChild<ElementRef<HTMLDivElement>>("trackEl");

  readonly duration = computed(() => this.timeline().totalSecs);
  readonly currentTime = signal(0);
  readonly currentClipIndex = signal(0);
  readonly isPlaying = signal(false);
  readonly trimStart = signal(0);
  readonly trimEnd = signal(0);
  /** Which <video> is visible; the other preloads the next clip. */
  readonly activeSlot = signal<Slot>(0);

  readonly formatHms = formatHms;
  readonly MIN_TRIM_SECS = MIN_TRIM_SECS;

  /** Clip index loaded into each slot. */
  private slotClip: [number | null, number | null] = [null, null];
  private dragging: DragHandle = null;

  readonly currentEntry = computed(
    () => this.timeline().entries[this.currentClipIndex()] ?? null,
  );
  readonly startPct = computed(() =>
    this.duration() > 0 ? (this.trimStart() / this.duration()) * 100 : 0,
  );
  readonly endPct = computed(() =>
    this.duration() > 0 ? (this.trimEnd() / this.duration()) * 100 : 100,
  );
  readonly playheadPct = computed(() =>
    this.duration() > 0 ? (this.currentTime() / this.duration()) * 100 : 0,
  );
  /** Where each clip after the first starts, as a % of the track. */
  readonly boundaryPcts = computed(() =>
    this.duration() > 0
      ? this.timeline()
          .entries.slice(1)
          .map((e) => (e.offsetSecs / this.duration()) * 100)
      : [],
  );

  constructor() {
    // Start over from the top whenever a new set of clips is loaded.
    effect(() => {
      const timeline = this.timeline();
      const ready = this.videoA() && this.videoB();
      untracked(() => {
        this.currentTime.set(0);
        this.currentClipIndex.set(0);
        this.isPlaying.set(false);
        this.trimStart.set(0);
        this.trimEnd.set(timeline.totalSecs);
        this.activeSlot.set(0);
        this.slotClip = [null, null];
        if (!ready) return;
        for (const slot of [0, 1] as const) {
          const video = this.video(slot)!;
          video.pause();
          video.removeAttribute("src");
          video.load();
        }
        if (timeline.entries.length > 0) this.showClip(0, 0, false);
      });
    });

    const onMove = (e: PointerEvent) => this.onPointerMove(e);
    const onUp = () => this.onPointerUp();
    const onKey = (e: KeyboardEvent) => this.onKeyDown(e);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("keydown", onKey);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("keydown", onKey);
    });
  }

  /** Jumps to a position on the combined timeline, keeping play/pause state. */
  seek(globalSecs: number): void {
    const loc = locate(this.timeline(), globalSecs);
    if (!loc) return;
    this.currentTime.set(this.timeline().entries[loc.index].offsetSecs + loc.localSecs);
    this.showClip(loc.index, loc.localSecs, this.isPlaying());
  }

  togglePlay(): void {
    const video = this.video(this.activeSlot());
    if (!video || this.timeline().entries.length === 0) return;
    if (video.paused) {
      // Restart from the top rather than doing nothing at the very end.
      if (this.currentTime() >= this.duration()) {
        this.showClip(0, 0, true);
        return;
      }
      playQuietly(video);
    } else {
      video.pause();
    }
  }

  onTimeUpdate(slot: Slot): void {
    if (slot !== this.activeSlot() || this.dragging) return;
    const index = this.slotClip[slot];
    const entry = index === null ? undefined : this.timeline().entries[index];
    const video = this.video(slot);
    if (!entry || !video) return;
    // A clip can run slightly past its probed duration; don't let that
    // spill into the next clip's span.
    const local = Math.min(video.currentTime, entry.durationSecs);
    this.currentTime.set(entry.offsetSecs + local);
  }

  onPlay(slot: Slot): void {
    if (slot === this.activeSlot()) this.isPlaying.set(true);
  }

  onPause(slot: Slot): void {
    if (slot === this.activeSlot()) this.isPlaying.set(false);
  }

  onEnded(slot: Slot): void {
    if (slot !== this.activeSlot()) return;
    const next = (this.slotClip[slot] ?? 0) + 1;
    if (next < this.timeline().entries.length) {
      this.showClip(next, 0, true);
    } else {
      this.currentTime.set(this.duration());
    }
  }

  onTrackClick(event: MouseEvent): void {
    const fraction = this.trackFraction(event);
    if (fraction !== null) this.seek(fraction * this.duration());
  }

  /** Sets a trim point typed into the readout and shows that frame. */
  setTrim(handle: "start" | "end", secs: number): void {
    if (handle === "start") {
      this.trimStart.set(clamp(secs, 0, this.trimEnd() - MIN_TRIM_SECS));
      this.seek(this.trimStart());
    } else {
      this.trimEnd.set(clamp(secs, this.trimStart() + MIN_TRIM_SECS, this.duration()));
      this.seek(this.trimEnd());
    }
    this.trimChange.emit({ startSecs: this.trimStart(), endSecs: this.trimEnd() });
  }

  /**
   * Trims at the frame on screen, without moving the playhead. Marking past
   * the other trim point moves that one out of the way (to the very start or
   * end) instead of getting stuck against it.
   */
  markAtPlayhead(handle: "start" | "end"): void {
    const at = this.currentTime();
    if (handle === "start") {
      if (at > this.trimEnd() - MIN_TRIM_SECS) this.trimEnd.set(this.duration());
      this.trimStart.set(clamp(at, 0, this.trimEnd() - MIN_TRIM_SECS));
    } else {
      if (at < this.trimStart() + MIN_TRIM_SECS) this.trimStart.set(0);
      this.trimEnd.set(clamp(at, this.trimStart() + MIN_TRIM_SECS, this.duration()));
    }
    this.trimChange.emit({ startSecs: this.trimStart(), endSecs: this.trimEnd() });
  }

  /** Moves the playhead by `deltaSecs`, for fine-tuning a spot. */
  nudge(deltaSecs: number): void {
    this.seek(clamp(this.currentTime() + deltaSecs, 0, this.duration()));
  }

  startDrag(handle: DragHandle, event: PointerEvent): void {
    event.stopPropagation();
    this.dragging = handle;
  }

  /**
   * Makes clip `index` visible at `localSecs`, swapping to the hidden
   * <video> if it already has that clip preloaded, then preloads the
   * following clip into whichever <video> is now hidden.
   */
  private showClip(index: number, localSecs: number, play: boolean): void {
    const previous = this.activeSlot();
    const other: Slot = previous === 0 ? 1 : 0;
    const slot =
      this.slotClip[previous] !== index && this.slotClip[other] === index ? other : previous;

    this.loadInto(slot, index, localSecs);
    if (slot !== previous) {
      this.video(previous)?.pause();
      this.activeSlot.set(slot);
    }

    const video = this.video(slot);
    if (video) {
      if (play) playQuietly(video);
      else video.pause();
    }

    if (this.currentClipIndex() !== index) {
      this.currentClipIndex.set(index);
      this.currentClipChange.emit(index);
    }

    const next = index + 1;
    if (next < this.timeline().entries.length) {
      this.loadInto(slot === 0 ? 1 : 0, next, 0);
    }
  }

  private loadInto(slot: Slot, index: number, localSecs: number): void {
    const video = this.video(slot);
    if (!video) return;
    if (this.slotClip[slot] !== index) {
      this.slotClip[slot] = index;
      video.src = this.urlFor()(this.timeline().entries[index].clip.path);
    }
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      video.currentTime = localSecs;
    } else {
      // Can't seek before metadata loads; do it once it has, unless the
      // slot has been pointed at another clip by then.
      const src = video.src;
      video.addEventListener(
        "loadedmetadata",
        () => {
          if (video.src === src) video.currentTime = localSecs;
        },
        { once: true },
      );
    }
  }

  private video(slot: Slot): HTMLVideoElement | undefined {
    return (slot === 0 ? this.videoA() : this.videoB())?.nativeElement;
  }

  private trackFraction(event: MouseEvent): number | null {
    const track = this.trackEl()?.nativeElement;
    if (!track || this.duration() === 0) return null;
    const rect = track.getBoundingClientRect();
    return clamp((event.clientX - rect.left) / rect.width, 0, 1);
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.dragging) return;
    const fraction = this.trackFraction(event);
    if (fraction === null) return;
    const secs = fraction * this.duration();

    if (this.dragging === "start") {
      this.trimStart.set(Math.min(secs, this.trimEnd() - MIN_TRIM_SECS));
      this.seek(this.trimStart());
    } else {
      this.trimEnd.set(Math.max(secs, this.trimStart() + MIN_TRIM_SECS));
      this.seek(this.trimEnd());
    }
  }

  /** I/O mark trim points and ←/→ nudge, unless typing somewhere. */
  private onKeyDown(event: KeyboardEvent): void {
    if (this.timeline().entries.length === 0) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]")) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case "i":
        this.markAtPlayhead("start");
        break;
      case "o":
        this.markAtPlayhead("end");
        break;
      case "arrowleft":
        this.nudge(event.shiftKey ? -5 : -1);
        break;
      case "arrowright":
        this.nudge(event.shiftKey ? 5 : 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  private onPointerUp(): void {
    if (!this.dragging) return;
    this.dragging = null;
    this.trimChange.emit({ startSecs: this.trimStart(), endSecs: this.trimEnd() });
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Starts playback, ignoring the rejection a later load/pause causes by
 * interrupting it. */
function playQuietly(video: HTMLVideoElement): void {
  video.play()?.catch(() => {});
}
