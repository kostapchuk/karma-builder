/**
 * Лидерборды.
 *
 * Сортировка ТОЛЬКО по karma_total — подтверждённой ревью. Самооценённая карма
 * из V1 (karma_self_total) в рейтинг не входит принципиально: иначе накрученные
 * локальные баллы «отмывались» бы в глобальный топ и ревью теряло бы смысл.
 */

import { levelForXp, levelTitle } from '../../../lib/karma/scoring';
import type { Env } from '../env';
import { json } from '../http';
import type { UserRow } from '../data/users';

const PAGE_MAX = 100;

interface LeaderRow {
  id: number;
  username: string | null;
  first_name: string | null;
  photo_url: string | null;
  karma_total: number;
}

const entry = (row: LeaderRow, rank: number, meId: number | null) => ({
  rank,
  id: row.id,
  username: row.username,
  firstName: row.first_name,
  photoUrl: row.photo_url,
  karmaTotal: row.karma_total,
  level: levelForXp(row.karma_total),
  levelTitle: levelTitle(levelForXp(row.karma_total)),
  isMe: meId !== null && row.id === meId,
});

/** Позиция вне выданной страницы: сколько людей строго выше меня. */
async function rankOf(env: Env, user: UserRow): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS above FROM users WHERE karma_total > ?1 OR (karma_total = ?1 AND id < ?2)',
  )
    .bind(user.karma_total, user.id)
    .first<{ above: number }>();
  return (row?.above ?? 0) + 1;
}

export async function globalLeaderboard(
  request: Request,
  env: Env,
  user: UserRow | null,
): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(PAGE_MAX, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

  const { results } = await env.DB.prepare(
    `SELECT id, username, first_name, photo_url, karma_total FROM users
     ORDER BY karma_total DESC, id ASC LIMIT ?1 OFFSET ?2`,
  )
    .bind(limit, offset)
    .all<LeaderRow>();

  const rows = results ?? [];
  return json({
    entries: rows.map((row, i) => entry(row, offset + i + 1, user?.id ?? null)),
    me: user ? { id: user.id, rank: await rankOf(env, user), karmaTotal: user.karma_total } : null,
    hasMore: rows.length === limit,
  });
}

/**
 * Друзья. Дружба лежит двумя симметричными строками, поэтому это один JOIN
 * без OR и UNION — и никакого N+1: профили тянутся тем же запросом.
 */
export async function friendsLeaderboard(env: Env, user: UserRow): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.first_name, u.photo_url, u.karma_total
     FROM friendships f JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = ?1 AND f.status = 'accepted'
     UNION ALL
     SELECT id, username, first_name, photo_url, karma_total FROM users WHERE id = ?1
     ORDER BY karma_total DESC, id ASC`,
  )
    .bind(user.id)
    .all<LeaderRow>();

  const rows = results ?? [];
  return json({ entries: rows.map((row, i) => entry(row, i + 1, user.id)) });
}

/** Профиль другого юзера — read-only карточка друга. */
export async function friendProfile(env: Env, id: number): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT id, username, first_name, photo_url, karma_total, badges, deed_count, streak_longest FROM users WHERE id = ?1',
  )
    .bind(id)
    .first<LeaderRow & { badges: string; deed_count: number; streak_longest: number }>();

  if (!row) return json({ error: 'user_not_found' }, { status: 404 });

  let badges: [string, number][] = [];
  try {
    const parsed = JSON.parse(row.badges);
    if (Array.isArray(parsed)) badges = parsed;
  } catch {
    badges = [];
  }

  return json({
    profile: {
      id: row.id,
      username: row.username,
      firstName: row.first_name,
      photoUrl: row.photo_url,
      karmaTotal: row.karma_total,
      level: levelForXp(row.karma_total),
      levelTitle: levelTitle(levelForXp(row.karma_total)),
      deedCount: row.deed_count,
      longestStreak: row.streak_longest,
      badges: badges.map(([code, earnedAt]) => ({ code: String(code), earnedAt: Number(earnedAt) || 0 })),
    },
  });
}
