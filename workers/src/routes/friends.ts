/**
 * Друзья. Добавление идёт через deep-link Mini App:
 * `https://t.me/<bot>?startapp=f<id>` — Telegram отдаёт `start_param` в initData,
 * клиент присылает его сюда. Никаких заявок и подтверждений на MVP: перешёл
 * по чужой ссылке — значит, согласился.
 */

import type { Env } from '../env';
import { badRequest, json, notFound } from '../http';
import { sqlNow } from '../lib/time';
import type { UserRow } from '../data/users';

export const REFERRAL_PREFIX = 'f';

export const inviteRef = (userId: number) => `${REFERRAL_PREFIX}${userId}`;

export function inviteLink(env: Env, userId: number): string | null {
  if (!env.BOT_USERNAME) return null;
  return `https://t.me/${env.BOT_USERNAME}?startapp=${inviteRef(userId)}`;
}

/** Из `f42` достаём 42. Чужой формат просто игнорируем: это не ошибка клиента. */
export function parseRef(ref: unknown): number | null {
  if (typeof ref !== 'string') return null;
  const match = /^f(\d+)$/.exec(ref.trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function addFriend(request: Request, env: Env, user: UserRow): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { ref?: unknown } | null;
  const friendId = parseRef(body?.ref);
  if (friendId === null) throw badRequest('invalid_ref');
  if (friendId === user.id) throw badRequest('cannot_add_self');

  const friend = await env.DB.prepare('SELECT id, first_name, username FROM users WHERE id = ?1')
    .bind(friendId)
    .first<{ id: number; first_name: string | null; username: string | null }>();
  if (!friend) throw notFound('friend_not_found');

  const now = sqlNow();
  // Две симметричные строки: «мои друзья» — это WHERE user_id = ?, без OR.
  await env.DB.batch([
    // Кто пригласил — ставится один раз и только тому, кто ещё не начинал.
    // Условия внутри UPDATE, а не проверками до него: иначе два одновременных
    // перехода по разным ссылкам могли бы оба записать себя пригласившим.
    //
    //   referred_by IS NULL      — приглашение не переигрывается;
    //   deed_count = 0           — состоявшийся юзер не становится чьим-то
    //   AND karma_total = 0        приглашённым задним числом;
    //   NOT EXISTS(...)          — взаимные приглашения по кругу, где двое
    //                              приводят друг друга и оба получают бонус.
    env.DB.prepare(
      `UPDATE users SET referred_by = ?1
       WHERE id = ?2
         AND referred_by IS NULL
         AND deed_count = 0
         AND karma_total = 0
         AND NOT EXISTS (SELECT 1 FROM users WHERE id = ?1 AND referred_by = ?2)`,
    ).bind(friendId, user.id),
    env.DB.prepare(
      `INSERT INTO friendships (user_id, friend_id, status, created_at) VALUES (?1, ?2, 'accepted', ?3)
       ON CONFLICT(user_id, friend_id) DO UPDATE SET status = 'accepted'`,
    ).bind(user.id, friendId, now),
    env.DB.prepare(
      `INSERT INTO friendships (user_id, friend_id, status, created_at) VALUES (?1, ?2, 'accepted', ?3)
       ON CONFLICT(user_id, friend_id) DO UPDATE SET status = 'accepted'`,
    ).bind(friendId, user.id, now),
  ]);

  return json({ friend: { id: friend.id, firstName: friend.first_name, username: friend.username } });
}
