import { formatRelativeTime, formatTimestamp } from "./format-time";

/** A relative time with the exact UTC timestamp on hover. */
export function SettingsTime({ date }: { date: Date }) {
  return (
    <time dateTime={date.toISOString()} title={formatTimestamp(date)}>
      {formatRelativeTime(date)}
    </time>
  );
}
