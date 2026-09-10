import { TestBed } from "@angular/core/testing";
import { clamp, VideoPreviewComponent } from "./video-preview.component";

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
  function create() {
    TestBed.configureTestingModule({ imports: [VideoPreviewComponent] });
    const fixture = TestBed.createComponent(VideoPreviewComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it("reports 0% for every percentage before a duration is known", () => {
    const preview = create();
    expect(preview.startPct()).toBe(0);
    expect(preview.endPct()).toBe(100);
    expect(preview.playheadPct()).toBe(0);
  });

  it("computes trim handle percentages from duration", () => {
    const preview = create();
    preview.duration.set(100);
    preview.trimStart.set(25);
    preview.trimEnd.set(75);

    expect(preview.startPct()).toBe(25);
    expect(preview.endPct()).toBe(75);
  });

  it("computes the playhead percentage from current time", () => {
    const preview = create();
    preview.duration.set(200);
    preview.currentTime.set(50);

    expect(preview.playheadPct()).toBe(25);
  });

  it("resets duration/trim state whenever the src input changes", () => {
    const fixture = TestBed.configureTestingModule({
      imports: [VideoPreviewComponent],
    }).createComponent(VideoPreviewComponent);
    fixture.componentRef.setInput("src", "asset://a.mp4");
    fixture.detectChanges();

    fixture.componentInstance.duration.set(42);
    fixture.componentInstance.trimEnd.set(42);

    fixture.componentRef.setInput("src", "asset://b.mp4");
    fixture.detectChanges();

    expect(fixture.componentInstance.duration()).toBe(0);
    expect(fixture.componentInstance.trimEnd()).toBe(0);
  });
});
