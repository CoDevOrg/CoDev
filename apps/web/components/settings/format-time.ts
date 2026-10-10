const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const absolute = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/** "5 minutes ago", "yesterday", "in 3 weeks". */
export function formatRelativeTime(date: Date, now = Date.now()) {
  const seconds = Math.round((date.getTime() - now) / 1000);
  const unit = UNITS.find(([, size]) => Math.abs(seconds) >= size);
  return unit
    ? relative.format(Math.round(seconds / unit[1]), unit[0])
    : "just now";
}

export function formatTimestamp(date: Date) {
  return `${absolute.format(date)} UTC`;
}
