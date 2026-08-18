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
  level: number;
  streak_current: number;
  streak_longest: number;
  last_deed_date: string | null;
  deed_count: number;
  category_counts: string;
  badges: string;
  created_at: string;
  last_active_at: string | null;
}

/**
 * Первый запрос от юзера заводит строку, последующие обновляют профиль: имя и
 * аватар в Telegram меняются, а лидерборд должен показывать текущие.
 *
 * `limit > 0` закрывает набор: новых не пускаем, уже заведённые продолжают
 * ходить как ни в чём не бывало. Условие «мест ещё хватает» живёт внутри
 * `INSERT ... SELECT`, а не в отдельной проверке до него: иначе два первых
 * запуска, пришедшие одновременно, оба увидели бы свободное место и оба
 * записались бы за потолок.
 *
 * Своих условие пропускает отдельной веткой `EXISTS`, и это не украшение:
 * при полной таблице `WHERE` не отдаёт ни одной строки, вставлять становится
 * нечего — а значит, и `ON CONFLICT DO UPDATE` не срабатывает. Без этой ветки
 * закрытый набор выгонял бы вообще всех, включая уже заведённых.
 */
export async function upsertUser(
  db: D1Database,
  user: TelegramUser,
  limit = 0,
): Promise<UserRow | null> {
  const now = sqlNow();
  const row = await db
    .prepare(
      `INSERT INTO users (telegram_id, username, first_name, photo_url, category_counts, last_active_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE ?7 = 0
          OR EXISTS (SELECT 1 FROM users WHERE telegram_id = ?1)
          OR (SELECT COUNT(*) FROM users) < ?7
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
      limit,
    )
    .first<UserRow>();

  // Пусто = мест не осталось, а этого telegram_id среди своих нет: строка не
  // вставилась, и обновлять было нечего.
  return row ?? null;
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
  };
}
