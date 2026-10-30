export function parseClock(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) throw new Error("Store hours must use HH:MM format.");
  const hour = Number(match[1]), minute = Number(match[2]);
  if (minute > 59 || hour > 24 || (hour === 24 && minute !== 0)) throw new Error("Store hours contain an invalid time.");
  return hour * 60 + minute;
}

export function localMinuteOfDay(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

export function isStoreOpen(date, timeZone, openTime, closeTime) {
  const open = parseClock(openTime), close = parseClock(closeTime);
  const minute = localMinuteOfDay(date, timeZone);
  if (open < close) return minute >= open && minute < close;
  if (close === 0) return minute >= open;
  return minute >= open || minute < close;
}
