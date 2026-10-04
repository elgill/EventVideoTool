import { ProgressEvent } from "./models";

/** What an export in progress is doing right now, for the status panel. */
export type ExportStage =
  /** ffmpeg is starting up and seeking to the trim start; no output yet. */
  | { kind: "preparing" }
  | { kind: "working"; percentage: number; detail: string }
  /** All frames are written; ffmpeg is finalizing the file. */
  | { kind: "finishing" };

export function exportStage(progress: ProgressEvent | null): ExportStage {
  if (!progress || progress.percentage <= 0) return { kind: "preparing" };
  if (progress.percentage >= 99.9) return { kind: "finishing" };

  const parts: string[] = [];
  if (progress.speed > 0) parts.push(`${formatSpeed(progress.speed)} speed`);
  const remaining = formatRemaining(progress.eta_secs);
  if (remaining) parts.push(remaining);
  if (progress.estimated_size_bytes) parts.push(`~${formatBytes(progress.estimated_size_bytes)}`);
  return { kind: "working", percentage: progress.percentage, detail: parts.join(" · ") };
}

function formatSpeed(speed: number): string {
  return `${speed >= 10 ? Math.round(speed) : speed.toFixed(1)}×`;
}

/** A rough, human time-left, e.g. "about 3 min left". */
export function formatRemaining(etaSecs: number | null): string | null {
  if (etaSecs === null || !Number.isFinite(etaSecs) || etaSecs < 0) return null;
  if (etaSecs < 10) return "a few seconds left";
  if (etaSecs < 60) return `about ${Math.round(etaSecs / 5) * 5} s left`;
  if (etaSecs < 3600) return `about ${Math.round(etaSecs / 60)} min left`;
  const hours = Math.floor(etaSecs / 3600);
  return `about ${hours} h ${Math.round((etaSecs % 3600) / 60)} min left`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
