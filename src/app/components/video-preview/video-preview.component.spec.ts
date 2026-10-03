import { TestBed } from "@angular/core/testing";
import { clamp, VideoPreviewComponent } from "./video-preview.component";
import { buildTimeline } from "../../timeline";

describe("clamp", () => {
  it("passes through in-range values", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps below the minimum", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps above the maximum", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe("VideoPreviewComponent", () => {
  // a = [0, 50), b = [50, 200)
  const timeline = buildTimeline([
    { name: "a.mp4", path: "/clips/a.mp4", duration_secs: 50 },
    { name: "b.mp4", path: "/clips/b.mp4", duration_secs: 150 },
  ]);

  // jsdom doesn't implement media playback and logs on every call.
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  function create() {
    TestBed.configureTestingModule({ imports: [VideoPreviewComponent] });
    const fixture = TestBed.createComponent(VideoPreviewComponent);
    fixture.detectChanges();
    return fixture;
  }

  function createWithTimeline() {
    const fixture = create();
    fixture.componentRef.setInput("timeline", timeline);
    fixture.detectChanges();
    return fixture;
  }

  function videoSrcs(fixture: ReturnType<typeof create>): string[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll("video"),
      (v) => v.getAttribute("src") ?? "",
    );
  }

  it("reports neutral percentages before any clips are loaded", () => {
    const preview = create().componentInstance;
    expect(preview.startPct()).toBe(0);
    expect(preview.endPct()).toBe(100);
    expect(preview.playheadPct()).toBe(0);
  });

  it("uses the combined duration of every clip", () => {
    const preview = createWithTimeline().componentInstance;
    expect(preview.duration()).toBe(200);
    expect(preview.trimEnd()).toBe(200);
  });

  it("applies a typed trim point, keeps start before end, and seeks to it", () => {
    const preview = createWithTimeline().componentInstance;
    const emitted: unknown[] = [];
    preview.trimChange.subscribe((r) => emitted.push(r));

    preview.setTrim("start", 120);
    expect(preview.trimStart()).toBe(120);
    expect(preview.currentTime()).toBe(120);

    preview.setTrim("end", 60);
    expect(preview.trimEnd()).toBeCloseTo(120.1);
    expect(emitted.at(-1)).toEqual({ startSecs: 120, endSecs: preview.trimEnd() });
  });

  it("computes trim handle and playhead percentages on the combined timeline", () => {
    const preview = createWithTimeline().componentInstance;
    preview.trimStart.set(50);
    preview.trimEnd.set(150);
    preview.currentTime.set(100);

    expect(preview.startPct()).toBe(25);
    expect(preview.endPct()).toBe(75);
    expect(preview.playheadPct()).toBe(50);
  });

  it("marks where each clip after the first starts", () => {
    const preview = createWithTimeline().componentInstance;
    expect(preview.boundaryPcts()).toEqual([25]);
  });

  it("shows the first clip and preloads the second", () => {
    const fixture = createWithTimeline();
    expect(videoSrcs(fixture)).toEqual(["/clips/a.mp4", "/clips/b.mp4"]);
    expect(fixture.componentInstance.activeSlot()).toBe(0);
  });

  it("seeking into the preloaded clip swaps to it and preloads past it", () => {
    const fixture = createWithTimeline();
    const preview = fixture.componentInstance;
    const changes: number[] = [];
    preview.currentClipChange.subscribe((i) => changes.push(i));

    preview.seek(120);

    expect(preview.activeSlot()).toBe(1);
    expect(preview.currentClipIndex()).toBe(1);
    expect(preview.currentTime()).toBe(120);
    expect(changes).toEqual([1]);
  });

  it("resets position and trim whenever the clips change", () => {
    const fixture = createWithTimeline();
    const preview = fixture.componentInstance;
    preview.seek(120);
    preview.trimStart.set(10);

    fixture.componentRef.setInput(
      "timeline",
      buildTimeline([{ name: "c.mp4", path: "/clips/c.mp4", duration_secs: 30 }]),
    );
    fixture.detectChanges();

    expect(preview.currentTime()).toBe(0);
    expect(preview.currentClipIndex()).toBe(0);
    expect(preview.activeSlot()).toBe(0);
    expect(preview.trimStart()).toBe(0);
    expect(preview.trimEnd()).toBe(30);
    expect(videoSrcs(fixture)[0]).toBe("/clips/c.mp4");
  });
});
