/**
 * Доменные типы V1. Никаких зависимостей — модуль читается и на клиенте,
 * и (в V2) на сервере.
 */

export type DeedCategory =
  | 'helping_person'
  | 'animal_care'
  | 'environment'
  | 'volunteering'
  | 'donation'
  | 'kindness_gesture'
  | 'self_improvement'
  | 'other';

/** 1 — small (≤15 мин), 2 — medium (~час), 3 — large (значимое время). */
export type EffortLevel = 1 | 2 | 3;

export interface Deed {
  /** короткий nanoid */
  id: string;
  /** заметка; на баллы НЕ влияет */
  description: string;
  category: DeedCategory;
  effortLevel: EffortLevel;
  karmaPoints: number;
  /** epoch seconds — компактнее ISO-строки */
  createdAt: number;
}

/** Производное состояние: считается из totalKarma, на диске не хранится. */
export interface KarmaState {
  totalKarma: number;
  level: number;
  /** сколько XP набрано внутри текущего уровня */
  currentLevelXp: number;
  /** сколько XP осталось до следующего уровня */
  xpToNextLevel: number;
  updatedAt: number;
}

export interface Streak {
  /** подряд идущих дней с ≥1 делом */
  currentStreak: number;
  longestStreak: number;
  /** YYYY-MM-DD */
  lastDeedDate: string;
}

export interface Badge {
  code: string;
  earnedAt: number;
}

/** Счётчики дел по категориям, в порядке DEED_CATEGORIES. */
export type CategoryCounts = number[];
