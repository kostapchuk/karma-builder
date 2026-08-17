/**
 * Каталог бейджей. На диске у бейджа хранится только `code` + время получения;
 * заголовки и описания живут здесь, в коде.
 */

import { DEED_CATEGORIES } from './scoring';
import type { Badge, CategoryCounts, Streak } from './types';

export interface BadgeDefinition {
  code: string;
  title: string;
  description: string;
  icon: string;
}

export const BADGES: readonly BadgeDefinition[] = [
  { code: 'first_deed', title: 'Первый шаг', description: 'Первое записанное дело', icon: '🌱' },
  { code: 'deeds_10', title: 'Разогрев', description: '10 добрых дел', icon: '🔟' },
  { code: 'deeds_50', title: 'Привычка', description: '50 добрых дел', icon: '💫' },
  { code: 'deeds_100', title: 'Сотня', description: '100 добрых дел', icon: '💯' },
  { code: 'deeds_500', title: 'Легенда', description: '500 добрых дел', icon: '🏆' },
  { code: 'streak_7', title: 'Неделя подряд', description: '7 дней со стриком', icon: '🔥' },
  { code: 'streak_30', title: 'Месяц подряд', description: '30 дней со стриком', icon: '🌋' },
  { code: 'level_5', title: 'Хранитель', description: 'Достигнут 5-й уровень', icon: '🛡️' },
  { code: 'level_10', title: 'Просветлённый', description: 'Достигнут 10-й уровень', icon: '✨' },
  {
    code: 'category_collector',
    title: 'Коллекционер',
    description: 'Хотя бы одно дело в каждой категории',
    icon: '🎯',
  },
] as const;

export function badgeDefinition(code: string): BadgeDefinition | undefined {
  return BADGES.find((b) => b.code === code);
}

export interface BadgeContext {
  deedCount: number;
  level: number;
  streak: Streak;
  categoryCounts: CategoryCounts;
}

/** Условия получения. Все проверки — «достигнут порог», бейджи не отбираются обратно. */
const PREDICATES: Record<string, (ctx: BadgeContext) => boolean> = {
  first_deed: (c) => c.deedCount >= 1,
  deeds_10: (c) => c.deedCount >= 10,
  deeds_50: (c) => c.deedCount >= 50,
  deeds_100: (c) => c.deedCount >= 100,
  deeds_500: (c) => c.deedCount >= 500,
  streak_7: (c) => c.streak.longestStreak >= 7,
  streak_30: (c) => c.streak.longestStreak >= 30,
  level_5: (c) => c.level >= 5,
  level_10: (c) => c.level >= 10,
  category_collector: (c) =>
    DEED_CATEGORIES.every((_, i) => (c.categoryCounts[i] ?? 0) > 0),
};

/** Возвращает только НОВЫЕ бейджи — чтобы UI показал их и дал haptic. */
export function evaluateNewBadges(
  earned: Badge[],
  ctx: BadgeContext,
  now: number,
): Badge[] {
  const have = new Set(earned.map((b) => b.code));
  return BADGES.filter((def) => !have.has(def.code) && PREDICATES[def.code]?.(ctx)).map(
    (def) => ({ code: def.code, earnedAt: now }),
  );
}
