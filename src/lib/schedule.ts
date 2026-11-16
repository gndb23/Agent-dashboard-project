/** Friendly schedule text ↔ cron. Pure (no Node APIs) so the browser can use it too. */
import { CronExpressionParser } from "cron-parser";


export type ScheduleResult = { cron: string | null; label: string } | { error: string };

function hhmm(t: string): [number, number] | null {
  const m = /^(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?$/i.exec(t.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return [h, min];
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Accepts friendly schedules or raw cron:
 *   "" / "none" / "on demand"     → no schedule
 *   "daily 05:30", "daily 5pm"    → "30 5 * * *"
 *   "weekdays 08:00"              → "0 8 * * 1-5"
 *   "every 30m" / "every 2h"      → "*\/30 * * * *" / "0 *\/2 * * *"
 *   "hourly"                      → "0 * * * *"
 *   "0 5 * * *"                   → as is (validated)
 */
export function scheduleToCron(input: string): ScheduleResult {
  const s = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s || s === "none" || s === "on demand" || s === "manual") return { cron: null, label: "on demand" };
  if (s === "hourly") return { cron: "0 * * * *", label: "every hour" };
  let m = /^(daily|every day|weekdays|weekends) (?:at )?(.+)$/.exec(s);
  if (m) {
    const t = hhmm(m[2]);
    if (!t) return { error: `Couldn't read the time "${m[2]}". Use 24-hour HH:MM, e.g. 05:30.` };
    const dow = m[1] === "weekdays" ? "1-5" : m[1] === "weekends" ? "0,6" : "*";
    const when = m[1] === "weekdays" ? "weekdays" : m[1] === "weekends" ? "weekends" : "daily";
    return { cron: `${t[1]} ${t[0]} * * ${dow}`, label: `${when} at ${pad(t[0])}:${pad(t[1])}` };
  }
  m = /^every (\d+) ?(m|min|mins|minutes|h|hr|hrs|hours)$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    const minutes = m[2].startsWith("m");
    if (minutes && (n < 1 || n > 59 || 60 % n !== 0)) return { error: "Minutes must divide 60 evenly (e.g. 5, 10, 15, 30)." };
    if (!minutes && (n < 1 || n > 23 || 24 % n !== 0)) return { error: "Hours must divide 24 evenly (e.g. 1, 2, 3, 4, 6, 8, 12)." };
    return minutes
      ? { cron: `*/${n} * * * *`, label: `every ${n} minutes` }
      : { cron: n === 1 ? "0 * * * *" : `0 */${n} * * *`, label: n === 1 ? "every hour" : `every ${n} hours` };
  }
  if (s.split(" ").length === 5) {
    try {
      CronExpressionParser.parse(s);
      return { cron: s, label: `cron "${s}"` };
    } catch (e) {
      return { error: `Invalid cron expression: ${(e as Error).message}` };
    }
  }
  return { error: 'Use e.g. "daily 05:30", "weekdays 08:00", "every 30m", "every 2h", a 5-field cron, or leave blank.' };
}


/** Next few fire times, for previews. */
export function nextRuns(cron: string, timezone?: string, count = 3, from = new Date()): Date[] {
  try {
    const it = CronExpressionParser.parse(cron, { currentDate: from, tz: timezone });
    return Array.from({ length: count }, () => it.next().toDate());
  } catch {
    return [];
  }
}
