export interface ScheduleConfig {
  workStart: string; // "HH:MM"
  windowHours: number;
  leaveHours: number;
}

function parseHHMM(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid time "${value}", expected HH:MM`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Invalid time "${value}"`);
  return hours * 60 + minutes;
}

function minutesToHHMMSS(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
}

/**
 * Computes the daily clock times (24h "HH:MM:SS") at which a keep-alive ping
 * should fire. Pings repeat every `windowHours` all day, anchored so that
 * exactly `leaveHours` remain in the window at `workStart` — the pre-warm
 * ping lands (windowHours - leaveHours) before work begins, and every
 * following renewal lands windowHours after the last one.
 */
export function computeDailyPingTimes(config: ScheduleConfig): string[] {
  const windowMin = Math.round(config.windowHours * 60);
  const leaveMin = Math.round(config.leaveHours * 60);
  if (windowMin <= 0) throw new Error("windowHours must be greater than 0");
  if (leaveMin < 0 || leaveMin >= windowMin) {
    throw new Error("leaveHours must be >= 0 and less than windowHours");
  }

  const workStartMin = parseHHMM(config.workStart);
  const prewarmOffset = windowMin - leaveMin;
  const firstPing = ((workStartMin - prewarmOffset) % 1440 + 1440) % 1440;

  // ceil(1440 / windowMin) steps of windowMin are exactly enough to close a
  // full 24h loop with no gap larger than windowMin; one more would just
  // land back near `firstPing` and produce a redundant near-duplicate entry.
  const times = new Set<number>();
  let t = firstPing;
  const occurrences = Math.ceil(1440 / windowMin);
  for (let i = 0; i < occurrences; i++) {
    times.add(t);
    t = (t + windowMin) % 1440;
  }

  return [...times].sort((a, b) => a - b).map(minutesToHHMMSS);
}
