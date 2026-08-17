/**
 * Единственный источник правды о баллах и уровнях.
 *
 * Модуль намеренно чистый: ни React, ни браузерных API. В V2 этот же файл
 * переиспользует серверный Worker, чтобы клиент и сервер считали одинаково.
 */

import type { DeedCategory, EffortLevel, KarmaState } from './types';

/**
 * Канонический порядок категорий. ВАЖНО: индекс в этом массиве уходит
 * в CloudStorage (компактная сериализация), поэтому порядок менять нельзя —
 * только дописывать в конец.
 */
export const DEED_CATEGORIES: readonly DeedCategory[] = [
  'helping_person',
  'animal_care',
  'environment',
  'volunteering',
  'donation',
  'kindness_gesture',
  'self_improvement',
  'other',
] as const;

export const CATEGORY_WEIGHTS: Readonly<Record<DeedCategory, number>> = {
  volunteering: 15,
  donation: 12,
  helping_person: 10,
  animal_care: 10,
  environment: 8,
  self_improvement: 6,
  kindness_gesture: 5,
  other: 5,
};

export const EFFORT_MULTIPLIERS: Readonly<Record<EffortLevel, number>> = {
  1: 1,
  2: 2,
  3: 3,
};

export const EFFORT_LEVELS: readonly EffortLevel[] = [1, 2, 3] as const;

/** Диапазон возможных значений — 5..45. */
export const MIN_DEED_POINTS = 5;
export const MAX_DEED_POINTS = 45;

/** Лимит длины описания. Описание — только заметка, на баллы не влияет. */
export const DESCRIPTION_MAX_LENGTH = 140;

/**
 * Текст не парсим: баллы = вес категории × множитель усилия.
 * В V2 это же число становится `base_score` — подсказкой рецензенту.
 */
export function computeKarmaPoints(
  category: DeedCategory,
  effortLevel: EffortLevel,
): number {
  return CATEGORY_WEIGHTS[category] * EFFORT_MULTIPLIERS[effortLevel];
}

/** Порог входа на уровень N: квадратичная RPG-кривая. */
export function minXpForLevel(level: number): number {
  if (level <= 1) return 0;
  return 25 * (level - 1) * level;
}

const LEVEL_TITLES: readonly string[] = [
  'Искра',
  'Огонёк',
  'Свет',
  'Доброе сердце',
  'Хранитель',
  'Наставник',
  'Вдохновитель',
  'Светоч',
  'Мудрец',
  'Просветлённый',
];

/** Титул уровня. Выше 10-го формула продолжается, титул — «Просветлённый ур. N». */
export function levelTitle(level: number): string {
  const title = LEVEL_TITLES[level - 1];
  if (title) return title;
  return `${LEVEL_TITLES[LEVEL_TITLES.length - 1]} ур. ${level}`;
}

/**
 * Обратная к minXp: 25·N² − 25·N − xp ≤ 0  ⇒  N ≤ (25 + √(625 + 100·xp)) / 50.
 * Корень считаем во float, затем подправляем целочисленной проверкой —
 * иначе на больших XP погрешность может дать уровень ±1.
 */
export function levelForXp(totalXp: number): number {
  const xp = Math.max(0, Math.floor(totalXp));
  let level = Math.floor((25 + Math.sqrt(625 + 100 * xp)) / 50);
  if (level < 1) level = 1;
  while (minXpForLevel(level + 1) <= xp) level += 1;
  while (level > 1 && minXpForLevel(level) > xp) level -= 1;
  return level;
}

/** Разворачивает totalKarma в производное состояние для UI. */
export function karmaStateFromTotal(
  totalKarma: number,
  updatedAt: number = Math.floor(Date.now() / 1000),
): KarmaState {
  const level = levelForXp(totalKarma);
  const floor = minXpForLevel(level);
  const ceil = minXpForLevel(level + 1);
  return {
    totalKarma,
    level,
    currentLevelXp: totalKarma - floor,
    xpToNextLevel: ceil - totalKarma,
    updatedAt,
  };
}

/** Доля прогресса внутри уровня, 0..1 — для прогресс-бара. */
export function levelProgress(totalKarma: number): number {
  const level = levelForXp(totalKarma);
  const floor = minXpForLevel(level);
  const span = minXpForLevel(level + 1) - floor;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (totalKarma - floor) / span));
}
