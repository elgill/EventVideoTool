import { exportStage, formatBytes, formatRemaining } from "./export-status";
import { ProgressEvent } from "./models";

function progress(overrides: Partial<ProgressEvent>): ProgressEvent {
  return {
    operation: "export",
    percentage: 0,
    speed: 0,
    eta_secs: null,
    estimated_size_bytes: null,
    ...overrides,
  };
}

describe("exportStage", () => {
  it("is preparing until ffmpeg reports output", () => {
    expect(exportStage(null)).toEqual({ kind: "preparing" });
    expect(exportStage(progress({ speed: 2 }))).toEqual({ kind: "preparing" });
  });

  it("describes progress while working", () => {
    expect(
      exportStage(
        progress({ percentage: 42, speed: 1.84, eta_secs: 200, estimated_size_bytes: 420e6 }),
      ),
    ).toEqual({
      kind: "working",
      percentage: 42,
      detail: "1.8× speed · about 3 min left · ~420 MB",
    });
  });

  it("leaves out details ffmpeg hasn't reported yet", () => {
    expect(exportStage(progress({ percentage: 5 }))).toEqual({
      kind: "working",
      percentage: 5,
      detail: "",
    });
  });

  it("is finishing once every frame is written", () => {
    expect(exportStage(progress({ percentage: 100 }))).toEqual({ kind: "finishing" });
  });
});

describe("formatRemaining", () => {
  it("rounds to something readable", () => {
    expect(formatRemaining(null)).toBeNull();
    expect(formatRemaining(4)).toBe("a few seconds left");
    expect(formatRemaining(43)).toBe("about 45 s left");
    expect(formatRemaining(200)).toBe("about 3 min left");
    expect(formatRemaining(3600 + 30 * 60)).toBe("about 1 h 30 min left");
  });
});

describe("formatBytes", () => {
  it("picks a sensible unit", () => {
    expect(formatBytes(512e3)).toBe("512 KB");
    expect(formatBytes(420.4e6)).toBe("420 MB");
    expect(formatBytes(2.34e9)).toBe("2.3 GB");
  });
});
