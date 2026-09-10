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
  viewChild,
} from "@angular/core";
import { formatHms } from "../../models";

export interface TrimRange {
  startSecs: number;
  endSecs: number;
}

type DragHandle = "start" | "end" | null;

@Component({
  selector: "app-video-preview",
  standalone: true,
  templateUrl: "./video-preview.component.html",
  styleUrl: "./video-preview.component.css",
})
export class VideoPreviewComponent {
  /** URL produced by `convertFileSrc`, or null when nothing is loaded. */
  readonly src = input<string | null>(null);
  readonly trimEnabled = input<boolean>(false);
  readonly trimChange = output<TrimRange>();

  readonly videoEl = viewChild<ElementRef<HTMLVideoElement>>("videoEl");
  readonly trackEl = viewChild<ElementRef<HTMLDivElement>>("trackEl");

  readonly duration = signal(0);
  readonly currentTime = signal(0);
  readonly isPlaying = signal(false);
  readonly trimStart = signal(0);
  readonly trimEnd = signal(0);

  readonly formatHms = formatHms;

  private dragging: DragHandle = null;

  readonly startPct = computed(() =>
    this.duration() > 0 ? (this.trimStart() / this.duration()) * 100 : 0,
  );
  readonly endPct = computed(() =>
    this.duration() > 0 ? (this.trimEnd() / this.duration()) * 100 : 100,
  );
  readonly playheadPct = computed(() =>
    this.duration() > 0 ? (this.currentTime() / this.duration()) * 100 : 0,
  );

  constructor() {
    // Reset trim range whenever a new source is loaded.
    effect(() => {
      this.src();
      this.duration.set(0);
      this.currentTime.set(0);
      this.trimStart.set(0);
      this.trimEnd.set(0);
    });

    const onMove = (e: PointerEvent) => this.onPointerMove(e);
    const onUp = () => this.onPointerUp();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    });
  }

  onLoadedMetadata(): void {
    const video = this.videoEl()?.nativeElement;
    if (!video) return;
    this.duration.set(video.duration);
    this.trimEnd.set(video.duration);
  }

  onTimeUpdate(): void {
    const video = this.videoEl()?.nativeElement;
    if (video) this.currentTime.set(video.currentTime);
  }

  togglePlay(): void {
    const video = this.videoEl()?.nativeElement;
    if (!video) return;
    if (video.paused) {
      video.play();
      this.isPlaying.set(true);
    } else {
      video.pause();
      this.isPlaying.set(false);
    }
  }

  onPlay(): void {
    this.isPlaying.set(true);
  }

  onPause(): void {
    this.isPlaying.set(false);
  }

  seekTo(fractionOfWidth: number): void {
    const video = this.videoEl()?.nativeElement;
    if (!video || this.duration() === 0) return;
    video.currentTime = fractionOfWidth * this.duration();
  }

  onTrackClick(event: MouseEvent): void {
    const track = this.trackEl()?.nativeElement;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    this.seekTo(fraction);
  }

  startDrag(handle: DragHandle, event: PointerEvent): void {
    event.stopPropagation();
    this.dragging = handle;
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.dragging) return;
    const track = this.trackEl()?.nativeElement;
    if (!track || this.duration() === 0) return;

    const rect = track.getBoundingClientRect();
    const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const secs = fraction * this.duration();

    if (this.dragging === "start") {
      this.trimStart.set(Math.min(secs, this.trimEnd() - 0.1));
      this.seekTo(this.trimStart() / this.duration());
    } else {
      this.trimEnd.set(Math.max(secs, this.trimStart() + 0.1));
      this.seekTo(this.trimEnd() / this.duration());
    }
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
