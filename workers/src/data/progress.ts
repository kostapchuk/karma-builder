/**
 * Пересчёт прогресса юзера. Чистые функции: на вход строка `users`, на выход —
 * что записать. Так это тестируется без D1 и повторяет V1-ядро один в один.
 *
 * Кто когда меняется:
 *   создание дела   → deed_count, category_counts, стрик, бейджи «за количество»
 *   аппрув ревью    → karma_total, level, бейджи «за уровень»
 *   импорт из V1    → karma_self_total (в лидерборды не идёт)
 *
 * Карма растёт только на аппруве: в этом весь смысл V2.
 */

import { evaluateNewBadges } from '../../../lib/karma/badges';
import { DEED_CATEGORIES, levelForXp } from '../../../lib/karma/scoring';
import { applyDeedToStreak } from '../../../lib/karma/streak';
import type { Badge, DeedCategory, Streak } from '../../../lib/karma/types';
import { badges, categoryCounts, streak, type UserRow } from './users';

export interface CreationUpdate {
  deedCount: number;
  categoryCounts: number[];
  streak: Streak;
  badges: Badge[];
  newBadges: Badge[];
}

export function applyDeedCreation(
  row: UserRow,
  category: DeedCategory,
  localDate: string,
  nowEpoch: number,
): CreationUpdate {
  const counts = categoryCounts(row);
  const index = DEED_CATEGORIES.indexOf(category);
  if (index >= 0) counts[index] += 1;

  const nextStreak = applyDeedToStreak(streak(row), localDate);
  const deedCount = row.deed_count + 1;
  const earned = badges(row);

  const newBadges = evaluateNewBadges(
    earned,
    { deedCount, level: levelForXp(row.karma_total), streak: nextStreak, categoryCounts: counts },
    nowEpoch,
  );

  return { deedCount, categoryCounts: counts, streak: nextStreak, badges: [...earned, ...newBadges], newBadges };
}

export interface ApprovalUpdate {
  karmaTotal: number;
  level: number;
  previousLevel: number;
  badges: Badge[];
  newBadges: Badge[];
}

/**
 * Карма считается инкрементом (`karma_total = karma_total + N`), а уровень —
 * от прочитанного значения. Если между чтением и записью проскочит второй
 * аппрув, карма всё равно верна, а уровень отстанет на один шаг — и починится
 * на следующем аппруве: наружу уровень всё равно считается из кармы.
 */
export function applyApproval(row: UserRow, finalScore: number, nowEpoch: number): ApprovalUpdate {
  const karmaTotal = row.karma_total + finalScore;
  const previousLevel = levelForXp(row.karma_total);
  const level = levelForXp(karmaTotal);
  const earned = badges(row);

  const newBadges = evaluateNewBadges(
    earned,
    {
      deedCount: row.deed_count,
      level,
      streak: streak(row),
      categoryCounts: categoryCounts(row),
    },
    nowEpoch,
  );

  return { karmaTotal, level, previousLevel, badges: [...earned, ...newBadges], newBadges };
}

/** Среднее двух оценок. Округление — половина вверх, как в плане. */
export function aggregateScore(scores: number[]): number {
  const sum = scores.reduce((acc, n) => acc + n, 0);
  return Math.round(sum / scores.length);
}
