/** Строка `users` и всё, что с ней делается на уровне БД. */

import { DEED_CATEGORIES, karmaStateFromTotal, levelTitle } from '../../../lib/karma/scoring';
import { currentStreakOn } from '../../../lib/karma/streak';
import type { Badge, Streak } from '../../../lib/karma/types';
import type { TelegramUser } from '../auth/telegramAuth';
import { sqlNow, utcDateKey } from '../lib/time';

export interface UserRow {
  id: number;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  photo_url: string | null;
  karma_total: number;
  karma_self_total: number;
  level: number;
  streak_current: number;
  streak_longest: number;
  last_deed_date: string | null;
  deed_count: number;
  category_counts: string;
  badges: string;
  legacy_imported_at: string | null;
  created_at: string;
  last_active_at: string | null;
}

/**
 * Первый запрос от юзера заводит строку, последующие обновляют профиль:
 * имя и аватар в Telegram меняются, а лидерборд должен показывать текущие.
 */
export async function upsertUser(db: D1Database, user: TelegramUser): Promise<UserRow> {
  const now = sqlNow();
  const row = await db
    .prepare(
      `INSERT INTO users (telegram_id, username, first_name, photo_url, category_counts, last_active_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(telegram_id) DO UPDATE SET
         username = excluded.username,
         first_name = excluded.first_name,
         photo_url = excluded.photo_url,
         last_active_at = excluded.last_active_at
       RETURNING *`,
    )
    .bind(
      user.id,
      user.username,
      user.firstName,
      user.photoUrl,
      JSON.stringify(DEED_CATEGORIES.map(() => 0)),
      now,
    )
    .first<UserRow>();

  if (!row) throw new Error('upsertUser returned no row');
  return row;
}

export function getUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first<UserRow>();
}

/** Счётчики категорий хранятся JSON-массивом; длина догоняется под текущий каталог. */
export function categoryCounts(row: UserRow): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.category_counts);
  } catch {
    parsed = [];
  }
  const list = Array.isArray(parsed) ? parsed : [];
  return DEED_CATEGORIES.map((_, i) => Number(list[i]) || 0);
}

export function badges(row: UserRow): Badge[] {
  try {
    const parsed = JSON.parse(row.badges);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is [string, number] => Array.isArray(x) && x.length >= 1)
      .map(([code, earnedAt]) => ({ code: String(code), earnedAt: Number(earnedAt) || 0 }));
  } catch {
    return [];
  }
}

export const encodeBadges = (list: Badge[]) => JSON.stringify(list.map((b) => [b.code, b.earnedAt]));

export function streak(row: UserRow): Streak {
  return {
    currentStreak: row.streak_current,
    longestStreak: row.streak_longest,
    lastDeedDate: row.last_deed_date ?? '',
  };
}

/** То, что уходит наружу. Уровень считается из кармы, а не берётся из колонки. */
export function publicProfile(row: UserRow, today: string = utcDateKey()) {
  const karma = karmaStateFromTotal(row.karma_total);
  return {
    id: row.id,
    telegramId: row.telegram_id,
    username: row.username,
    firstName: row.first_name,
    photoUrl: row.photo_url,
    karmaTotal: row.karma_total,
    karmaSelfTotal: row.karma_self_total,
    level: karma.level,
    levelTitle: levelTitle(karma.level),
    currentLevelXp: karma.currentLevelXp,
    xpToNextLevel: karma.xpToNextLevel,
    // Стрик «протухает» молча: в базе лежит число на момент последней записи.
    streak: currentStreakOn(streak(row), today),
    longestStreak: row.streak_longest,
    deedCount: row.deed_count,
    // Счётчики по категориям нужны профилю целиком, а история на клиенте
    // подгружается страницами — по ней их не сложить.
    categoryCounts: categoryCounts(row),
    badges: badges(row),
    legacyImported: row.legacy_imported_at !== null,
  };
}
