/** Время. В D1 всё лежит строками `YYYY-MM-DD HH:MM:SS` в UTC — как datetime('now'). */

export function sqlNow(date: Date = new Date()): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function sqlTimePlusHours(hours: number, from: Date = new Date()): string {
  return sqlNow(new Date(from.getTime() + hours * 3_600_000));
}

/** YYYY-MM-DD в UTC — фолбэк, когда клиент не прислал свой локальный день. */
export function utcDateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export const isExpired = (expiresAt: string, now: string = sqlNow()) => expiresAt <= now;
