/** Small date/time helpers: local day keys and friendly time labels. */

/** Local calendar day as YYYY-MM-DD (not UTC, so "today" matches the family's clock). */
export function dayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The last N day keys, oldest first, ending with `date`. */
export function lastDays(n: number, date = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(date);
    d.setDate(d.getDate() - (n - 1 - i));
    return dayKey(d);
  });
}

/** "07:00" -> "7:00 AM" */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** 60 -> "1 hour", 90 -> "1 hr 30 min", 45 -> "45 min" */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h} hr ${m} min`;
}

/** Greeting for the kid screen, based on the hour. */
export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** Short weekday label for a day key: "2026-10-27" -> "Tue" */
export function weekdayShort(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" });
}
