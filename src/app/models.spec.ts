import { formatEta, formatHms, parseHms } from "./models";

describe("formatHms", () => {
  it("formats zero", () => {
    expect(formatHms(0)).toBe("00:00:00");
  });

  it("formats sub-minute durations", () => {
    expect(formatHms(45)).toBe("00:00:45");
  });

  it("formats hours/minutes/seconds", () => {
    expect(formatHms(3723)).toBe("01:02:03");
  });

  it("floors fractional seconds", () => {
    expect(formatHms(59.9)).toBe("00:00:59");
  });

  it("clamps negative durations to zero", () => {
    expect(formatHms(-5)).toBe("00:00:00");
  });
});

describe("parseHms", () => {
  it("parses HH:MM:SS", () => {
    expect(parseHms("01:02:03")).toBe(3723);
  });

  it("parses MM:SS", () => {
    expect(parseHms("02:03")).toBe(123);
  });

  it("parses bare seconds", () => {
    expect(parseHms("42")).toBe(42);
  });

  it("round-trips with formatHms", () => {
    expect(parseHms(formatHms(3723))).toBe(3723);
  });

  it("throws on garbage input", () => {
    expect(() => parseHms("not-a-time")).toThrow();
  });
});

describe("formatEta", () => {
  it("returns N/A for null", () => {
    expect(formatEta(null)).toBe("N/A");
  });

  it("returns N/A for non-finite values", () => {
    expect(formatEta(Infinity)).toBe("N/A");
  });

  it("formats seconds-only durations", () => {
    expect(formatEta(12.34)).toBe("12.3 seconds");
  });

  it("formats minutes and seconds", () => {
    expect(formatEta(90)).toBe("1m 30.0s");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatEta(3661)).toBe("1h 1m 1.0s");
  });
});
