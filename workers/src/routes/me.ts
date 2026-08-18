/** Профиль текущего юзера. Всё, что нужно Home-экрану, одним запросом. */

import type { Env } from '../env';
import { json } from '../http';
import { publicProfile, type UserRow } from '../data/users';
import { inviteLink } from './friends';
import { utcDateKey } from '../lib/time';

export async function getMe(request: Request, env: Env, user: UserRow): Promise<Response> {
  const url = new URL(request.url);
  // День для «протухания» стрика приходит из клиента: он в своей зоне.
  const today = url.searchParams.get('today') ?? utcDateKey();

  const counters = await env.DB.prepare(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('pending','partially_reviewed')) AS pending,
       COUNT(*) FILTER (WHERE status = 'approved') AS approved
     FROM deeds WHERE user_id = ?1`,
  )
    .bind(user.id)
    .first<{ pending: number; approved: number }>();

  return json({
    profile: publicProfile(user, today),
    inviteLink: inviteLink(env, user.id),
    counts: {
      pending: counters?.pending ?? 0,
      approved: counters?.approved ?? 0,
    },
  });
}
