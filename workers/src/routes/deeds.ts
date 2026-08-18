/** CRUD дел и генерация ссылок на ревью. Всё под initData-авторизацией. */

import { REVIEWER_SLOTS } from '../../../lib/karma/review';
import { DESCRIPTION_MAX_LENGTH, computeKarmaPoints } from '../../../lib/karma/scoring';
import type { Env } from '../env';
import { reviewTtlHours } from '../env';
import { HttpError, badRequest, json, notFound, readJson } from '../http';
import {
  deedView,
  isDeedCategory,
  isEffortLevel,
  loadSlotData,
  reviewUrl,
  type DeedRow,
  type ReviewRow,
  type TokenRow,
} from '../data/deeds';
import { deedId, reviewToken } from '../lib/ids';
import { isDateKey, isExpired, sqlNow, sqlTimePlusHours, utcDateKey } from '../lib/time';
import { applyDeedCreation } from '../data/progress';
import { encodeBadges, publicProfile, type UserRow } from '../data/users';

const HISTORY_LIMIT_MAX = 100;

interface CreateDeedBody {
  description?: unknown;
  category?: unknown;
  effortLevel?: unknown;
  /** день в зоне пользователя; сервер живёт в UTC и сам его не знает */
  localDate?: unknown;
}

export async function createDeed(request: Request, env: Env, user: UserRow): Promise<Response> {
  const body = await readJson<CreateDeedBody>(request);

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length > DESCRIPTION_MAX_LENGTH) throw badRequest('description_too_long');
  if (!isDeedCategory(body.category)) throw badRequest('invalid_category');
  if (!isEffortLevel(body.effortLevel)) throw badRequest('invalid_effort_level');

  const localDate = isDateKey(body.localDate) ? body.localDate : utcDateKey();
  const now = sqlNow();
  const nowEpoch = Math.floor(Date.now() / 1000);
  const baseScore = computeKarmaPoints(body.category, body.effortLevel);
  const id = deedId();

  const update = applyDeedCreation(user, body.category, localDate, nowEpoch);

  // Дело и счётчики юзера — одним батчем: половинчатое состояние (дело есть,
  // стрик не двинулся) чинить некому.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO deeds (id, user_id, description, category, effort_level, base_score, status, local_date, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8)`,
    ).bind(id, user.id, description, body.category, body.effortLevel, baseScore, localDate, now),
    env.DB.prepare(
      `UPDATE users SET deed_count = ?1, category_counts = ?2, streak_current = ?3,
         streak_longest = ?4, last_deed_date = ?5, badges = ?6, last_active_at = ?7
       WHERE id = ?8`,
    ).bind(
      update.deedCount,
      JSON.stringify(update.categoryCounts),
      update.streak.currentStreak,
      update.streak.longestStreak,
      update.streak.lastDeedDate,
      encodeBadges(update.badges),
      now,
      user.id,
    ),
  ]);

  const row: DeedRow = {
    id,
    user_id: user.id,
    description,
    category: body.category,
    effort_level: body.effortLevel,
    base_score: baseScore,
    final_score: null,
    status: 'pending',
    local_date: localDate,
    created_at: now,
    resolved_at: null,
  };

  const nextUser: UserRow = {
    ...user,
    deed_count: update.deedCount,
    category_counts: JSON.stringify(update.categoryCounts),
    streak_current: update.streak.currentStreak,
    streak_longest: update.streak.longestStreak,
    last_deed_date: update.streak.lastDeedDate,
    badges: encodeBadges(update.badges),
  };

  return json({
    deed: deedView(env, row, [], [], now),
    profile: publicProfile(nextUser, localDate),
    newBadges: update.newBadges,
  });
}

export async function listDeeds(request: Request, env: Env, user: UserRow): Promise<Response> {
  const url = new URL(request.url);
  const statusFilter = url.searchParams.getAll('status').filter(Boolean);
  const limit = Math.min(HISTORY_LIMIT_MAX, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

  const where = ['user_id = ?1'];
  const binds: unknown[] = [user.id];
  if (statusFilter.length > 0) {
    where.push(`status IN (${statusFilter.map((_, i) => `?${binds.length + i + 1}`).join(',')})`);
    binds.push(...statusFilter);
  }

  const { results } = await env.DB.prepare(
    `SELECT * FROM deeds WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC, id DESC LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
  )
    .bind(...binds, limit, offset)
    .all<DeedRow>();

  const rows = results ?? [];
  const { tokens, reviews } = await loadSlotData(env.DB, rows.map((d) => d.id));
  const now = sqlNow();

  return json({
    deeds: rows.map((deed) =>
      deedView(
        env,
        deed,
        tokens.filter((t) => t.deed_id === deed.id),
        reviews.filter((r) => r.deed_id === deed.id),
        now,
      ),
    ),
    hasMore: rows.length === limit,
  });
}

async function ownDeed(env: Env, user: UserRow, id: string): Promise<DeedRow> {
  const deed = await env.DB.prepare('SELECT * FROM deeds WHERE id = ?1').bind(id).first<DeedRow>();
  // Чужое дело и несуществующее отвечают одинаково: перебором id ничего не узнать.
  if (!deed || deed.user_id !== user.id) throw notFound('deed_not_found');
  return deed;
}

export async function getDeed(env: Env, user: UserRow, id: string): Promise<Response> {
  const deed = await ownDeed(env, user, id);
  const { tokens, reviews } = await loadSlotData(env.DB, [id]);
  return json({ deed: deedView(env, deed, tokens, reviews) });
}

/**
 * Выдать ссылки на ревью. Шаг отдельный от создания дела: записать вечером,
 * разослать утром — это осознанный сценарий, а не недоделка.
 *
 * Идемпотентно: живой токен переиспользуется, мёртвый (истёк или использован
 * без записи оценки) заменяется на новый через ON CONFLICT — старый URL
 * перестаёт существовать в ту же секунду.
 */
export async function sendReview(request: Request, env: Env, user: UserRow, id: string): Promise<Response> {
  const deed = await ownDeed(env, user, id);
  if (deed.status === 'approved') throw new HttpError(409, 'deed_already_approved');

  const { tokens, reviews } = await loadSlotData(env.DB, [id]);
  const now = sqlNow();
  const expiresAt = sqlTimePlusHours(reviewTtlHours(env), new Date());

  const fresh: TokenRow[] = [];
  const statements: D1PreparedStatement[] = [];

  for (const slot of REVIEWER_SLOTS) {
    if (reviews.some((r: ReviewRow) => r.reviewer_slot === slot)) continue;

    const existing = tokens.find((t) => t.reviewer_slot === slot);
    const alive =
      existing && !existing.used_at && !existing.revoked_at && !isExpired(existing.expires_at, now);
    if (alive) {
      fresh.push(existing);
      continue;
    }

    const token = reviewToken();
    statements.push(
      env.DB.prepare(
        `INSERT INTO review_tokens (token, deed_id, reviewer_slot, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(deed_id, reviewer_slot) DO UPDATE SET
           token = excluded.token, created_at = excluded.created_at,
           expires_at = excluded.expires_at, used_at = NULL, revoked_at = NULL`,
      ).bind(token, id, slot, now, expiresAt),
    );
    fresh.push({
      token,
      deed_id: id,
      reviewer_slot: slot,
      created_at: now,
      expires_at: expiresAt,
      used_at: null,
      revoked_at: null,
    });
  }

  if (statements.length > 0) await env.DB.batch(statements);

  return json({
    links: fresh.map((t) => ({
      slot: t.reviewer_slot,
      url: reviewUrl(env, t.token),
      expiresAt: t.expires_at,
    })),
    deed: deedView(env, deed, fresh, reviews, now),
  });
}
