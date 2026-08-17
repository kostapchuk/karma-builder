/** Логика стриков. Чистая: дату передаём строкой, Date.now() внутри не дёргаем. */

import type { Streak } from './types';

export const EMPTY_STREAK: Streak = {
  currentStreak: 0,
  longestStreak: 0,
  lastDeedDate: '',
};

/** YYYY-MM-DD в локальной зоне пользователя — «день» для стрика календарный. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dateKeyFromEpochSeconds(seconds: number): string {
  return toDateKey(new Date(seconds * 1000));
}

/** Разница в календарных днях между двумя YYYY-MM-DD (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const msA = Date.UTC(ay, am - 1, ad);
  const msB = Date.UTC(by, bm - 1, bd);
  return Math.round((msB - msA) / 86_400_000);
}

/**
 * Пересчёт стрика при добавлении дела в день `today`.
 *
 * - тот же день → ничего не меняется (несколько дел за день не считаются дважды);
 * - следующий день → +1;
 * - пропуск → сброс в 1, при этом longestStreak сохраняется.
 */
export function applyDeedToStreak(streak: Streak, today: string): Streak {
  if (!streak.lastDeedDate) {
    return { currentStreak: 1, longestStreak: Math.max(1, streak.longestStreak), lastDeedDate: today };
  }

  const gap = daysBetween(streak.lastDeedDate, today);

  // Дело «задним числом» или в тот же день — счётчик не трогаем.
  if (gap <= 0) return streak;

  const currentStreak = gap === 1 ? streak.currentStreak + 1 : 1;
  return {
    currentStreak,
    longestStreak: Math.max(streak.longestStreak, currentStreak),
    lastDeedDate: today,
  };
}

/**
 * Стрик «протухает», если последнее дело было раньше вчера: в сторедже
 * лежит число на момент последней записи, а показать надо актуальное.
 */
export function currentStreakOn(streak: Streak, today: string): number {
  if (!streak.lastDeedDate) return 0;
  const gap = daysBetween(streak.lastDeedDate, today);
  return gap <= 1 ? streak.currentStreak : 0;
}
