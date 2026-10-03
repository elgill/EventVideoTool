import { ClipInfo } from "./models";
import { buildTimeline, locate } from "./timeline";

function clip(name: string, duration_secs: number | null): ClipInfo {
  return { name, path: `/clips/${name}`, duration_secs };
}

// a = [0, 10), b = [10, 30), c = [30, 35)
const clips = [clip("a.mp4", 10), clip("b.mp4", 20), clip("c.mp4", 5)];

describe("buildTimeline", () => {
  it("lays clips end to end", () => {
    const timeline = buildTimeline(clips);
    expect(timeline.entries.map((e) => e.offsetSecs)).toEqual([0, 10, 30]);
    expect(timeline.totalSecs).toBe(35);
  });

  it("is empty for no clips", () => {
    expect(buildTimeline([])).toEqual({ entries: [], totalSecs: 0 });
  });
});

describe("locate", () => {
  const timeline = buildTimeline(clips);

  it("finds the clip and local time for a position", () => {
    expect(locate(timeline, 12.5)).toEqual({ index: 1, localSecs: 2.5 });
  });

  it("assigns a boundary to the clip starting there", () => {
    expect(locate(timeline, 10)).toEqual({ index: 1, localSecs: 0 });
  });

  it("maps the very end to the end of the last clip", () => {
    expect(locate(timeline, 35)).toEqual({ index: 2, localSecs: 5 });
  });

  it("clamps positions outside the timeline", () => {
    expect(locate(timeline, -3)).toEqual({ index: 0, localSecs: 0 });
    expect(locate(timeline, 99)).toEqual({ index: 2, localSecs: 5 });
  });

  it("returns null for an empty timeline", () => {
    expect(locate(buildTimeline([]), 0)).toBeNull();
  });
});
