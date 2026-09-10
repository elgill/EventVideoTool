export interface ClipInfo {
  path: string;
  name: string;
  duration_secs: number | null;
}

export interface ProgressEvent {
  operation: "concat" | "process";
  percentage: number;
  speed: number;
  eta_secs: number | null;
  estimated_size_bytes: number | null;
}

export interface FinishedEvent {
  operation: "concat" | "process";
  success: boolean;
  message: string;
}

export interface ProcessOptions {
  mute: boolean;
  reEncode: boolean;
  hwAcceleration: boolean;
}

/** Formats a whole/fractional number of seconds as HH:MM:SS. */
export function formatHms(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Parses "HH:MM:SS" (or "MM:SS", or "SS") into total seconds. */
export function parseHms(value: string): number {
  const parts = value.split(":").map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) {
    throw new Error(`invalid time string: ${value}`);
  }
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  throw new Error(`invalid time string: ${value}`);
}

/** Formats an ETA in seconds the way the original tool's `format_eta` did. */
export function formatEta(etaSecs: number | null): string {
  if (etaSecs === null || !Number.isFinite(etaSecs)) return "N/A";
  const hours = Math.floor(etaSecs / 3600);
  const minutes = Math.floor((etaSecs % 3600) / 60);
  const seconds = etaSecs % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds.toFixed(1)}s`;
  if (minutes > 0) return `${minutes}m ${seconds.toFixed(1)}s`;
  return `${seconds.toFixed(1)} seconds`;
}
