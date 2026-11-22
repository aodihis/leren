const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Returns the wall clock time that `instant` shows in `timeZone`, expressed as the number of
 * milliseconds since the epoch that the same digits would have in UTC.
 */
function getWallClock(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));

  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));

  return Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
  );
}

/**
 * Formats an ISO 8601 instant as the `YYYY-MM-DDTHH:mm` value of a `datetime-local` input, showing
 * the wall clock time in `timeZone`. A null instant gives an empty string, which the input shows
 * as empty.
 */
export function isoToZonedLocal(iso: string | null, timeZone: string): string {
  if (!iso) {
    return "";
  }

  return new Date(getWallClock(Date.parse(iso), timeZone)).toISOString().slice(0, 16);
}

/**
 * Converts the `YYYY-MM-DDTHH:mm` value of a `datetime-local` input, read as wall clock time in
 * `timeZone`, to an ISO 8601 instant. An empty or malformed value gives null. The offset is looked up twice so
 * that a time near a daylight saving change uses the offset in effect at the result.
 */
export function zonedLocalToIso(local: string, timeZone: string): string | null {
  if (!LOCAL_DATE_TIME.test(local)) {
    return null;
  }

  const wallClock = Date.parse(`${local}:00Z`);

  const firstGuess = wallClock - (getWallClock(wallClock, timeZone) - wallClock);
  const instant = wallClock - (getWallClock(firstGuess, timeZone) - firstGuess);

  return new Date(instant).toISOString();
}
