import { ClipInfo } from "./models";

/** A clip's place on the combined timeline (every clip laid end to end). */
export interface TimelineEntry {
  clip: ClipInfo;
  offsetSecs: number;
  durationSecs: number;
}

export interface Timeline {
  entries: TimelineEntry[];
  totalSecs: number;
}

/** Where a combined-timeline position falls: which clip, and how far into it. */
export interface TimelineLocation {
  index: number;
  localSecs: number;
}

/**
 * Lays `clips` end to end. Clips with an unknown duration count as 0 here,
 * so callers should refuse to build a timeline from them (as the backend's
 * `plan_segments` does) rather than show a timeline that's silently wrong.
 */
export function buildTimeline(clips: ClipInfo[]): Timeline {
  let offsetSecs = 0;
  const entries = clips.map((clip) => {
    const durationSecs = clip.duration_secs ?? 0;
    const entry = { clip, offsetSecs, durationSecs };
    offsetSecs += durationSecs;
    return entry;
  });
  return { entries, totalSecs: offsetSecs };
}

/**
 * Maps a combined-timeline position onto a clip. Positions are clamped to
 * the timeline; a position exactly on a boundary belongs to the clip that
 * starts there, except the very end, which is the end of the last clip.
 */
export function locate(timeline: Timeline, globalSecs: number): TimelineLocation | null {
  const { entries, totalSecs } = timeline;
  if (entries.length === 0) return null;
  const t = Math.min(Math.max(globalSecs, 0), totalSecs);

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (t >= entry.offsetSecs && (t < entry.offsetSecs + entry.durationSecs || t === totalSecs)) {
      return { index, localSecs: t - entry.offsetSecs };
    }
  }
  return { index: 0, localSecs: 0 };
}
