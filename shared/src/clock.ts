// The evening clock: picks, groups and the daily shuffle turn over at 4 am, not midnight.

export const DAY = 24 * 60 * 60 * 1000;

/** The daily shuffle turns over at this hour, local time, so no evening spans two days. */
const DAY_TURNS_AT_HOUR = 4;

/** The evening `now` belongs to, as YYYY-MM-DD in the local time zone (the server's TZ). */
export function pickingDay(now: number) {
  const d = new Date(now - DAY_TURNS_AT_HOUR * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** When the evening `now` belongs to began: the turnover hour on its picking day. */
export function dayStart(now: number) {
  const d = new Date(now - DAY_TURNS_AT_HOUR * 60 * 60 * 1000);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), DAY_TURNS_AT_HOUR).getTime();
}
