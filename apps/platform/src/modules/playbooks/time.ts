const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Returns the wall clock time of an instant. */
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

/** Formats an instant for a datetime-local input. */
export function isoToZonedLocal(iso: string | null, timeZone: string): string {
  if (!iso) {
    return "";
  }

  return new Date(getWallClock(Date.parse(iso), timeZone)).toISOString().slice(0, 16);
}

/** Parses a datetime-local value into an instant. */
export function zonedLocalToIso(local: string, timeZone: string): string | null {
  if (!LOCAL_DATE_TIME.test(local)) {
    return null;
  }

  const wallClock = Date.parse(`${local}:00Z`);

  const firstGuess = wallClock - (getWallClock(wallClock, timeZone) - wallClock);
  const instant = wallClock - (getWallClock(firstGuess, timeZone) - firstGuess);

  return new Date(instant).toISOString();
}
