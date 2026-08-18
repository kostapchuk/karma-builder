/**
 * Маршрут проверяющего. Самая критичная часть V2: ровно здесь начисляется карма.
 *
 * Ссылка ведёт в Mini App (`?startapp=r<token>`), поэтому проверяющий опознан —
 * раньше страница открывалась в любом браузере без логина, и автор мог
 * подтвердить собственное дело сам.
 *
 * Четыре инварианта, за которые отвечает этот файл:
 *   1. по одной ссылке засчитывается ровно одна оценка — даже при гонке;
 *   2. карма за дело начисляется ровно один раз — даже если сабмиты
 *      одновременно увидят, что оценок набралось достаточно;
 *   3. автор не оценивает своё дело;
 *   4. один человек не оценивает одно дело дважды.
 *
 * Первые два держатся не на проверках в коде, а на условиях в SQL внутри одной
 * транзакции: проверка «свободно ли» и запись происходят неразделимо. Четвёртый
 * страхуется уникальным индексом `(deed_id, reviewer_user_id)` — код проверяет
 * его заранее только ради внятного ответа.
 */

import {
  HUNDREDTHS_PER_POINT,
  REFERRAL_JOIN_BONUS,
  REFERRAL_SHARE_PERCENT,
} from '../../../lib/karma/referral';
import {
  MAX_REVIEW_SCORE,
  REVIEW_ANCHORS,
  REVIEW_COMMENT_MAX_LENGTH,
  REVIEWER_SLOTS,
  isValidScore,
} from '../../../lib/karma/review';
import type { DeedRow, ReviewRow, TokenRow } from '../data/deeds';
import { aggregateScore, applyApproval } from '../data/progress';
import { encodeBadges, getUserById, type UserRow } from '../data/users';
import type { Env } from '../env';
import { HttpError, badRequest, json, notFound, readJson } from '../http';
import { isExpired, sqlNow } from '../lib/time';

interface TokenContext extends TokenRow {
  deed: DeedRow;
  author_first_name: string | null;
  author_photo_url: string | null;
}

async function loadToken(env: Env, token: string): Promise<TokenContext | null> {
  const row = await env.DB.prepare(
    `SELECT t.*, d.id AS d_id, d.user_id AS d_user_id, d.description AS d_description,
            d.category AS d_category, d.effort_level AS d_effort_level, d.base_score AS d_base_score,
            d.final_score AS d_final_score, d.status AS d_status, d.local_date AS d_local_date,
            d.created_at AS d_created_at, d.resolved_at AS d_resolved_at,
            u.first_name AS author_first_name, u.photo_url AS author_photo_url
     FROM review_tokens t
     JOIN deeds d ON d.id = t.deed_id
     JOIN users u ON u.id = d.user_id
     WHERE t.token = ?1`,
  )
    .bind(token)
    .first<Record<string, never>>();

  if (!row) return null;
  const r = row as unknown as Record<string, unknown>;

  return {
    token: r.token as string,
    deed_id: r.deed_id as string,
    reviewer_slot: r.reviewer_slot as number,
    created_at: r.created_at as string,
    expires_at: r.expires_at as string,
    used_at: (r.used_at as string) ?? null,
    revoked_at: (r.revoked_at as string) ?? null,
    author_first_name: (r.author_first_name as string) ?? null,
    author_photo_url: (r.author_photo_url as string) ?? null,
    deed: {
      id: r.d_id as string,
      user_id: r.d_user_id as number,
      description: r.d_description as string,
      category: r.d_category as string,
      effort_level: r.d_effort_level as number,
      base_score: r.d_base_score as number,
      final_score: (r.d_final_score as number) ?? null,
      status: r.d_status as DeedRow['status'],
      local_date: r.d_local_date as string,
      created_at: r.d_created_at as string,
      resolved_at: (r.d_resolved_at as string) ?? null,
    },
  };
}

/** Почему ссылка не работает — клиент показывает разный текст. */
function linkProblem(ctx: TokenContext, viewer: UserRow, now: string): string | null {
  // Своё дело — первым делом: автору незачем читать чужие подсказки по оценке,
  // и текст ему нужен не «ссылка использована», а «нельзя оценивать себя».
  if (ctx.deed.user_id === viewer.id) return 'cannot_review_own_deed';
  if (ctx.revoked_at) return 'link_revoked';
  if (ctx.used_at) return 'link_used';
  if (isExpired(ctx.expires_at, now)) return 'link_expired';
  if (ctx.deed.status === 'approved') return 'deed_already_approved';
  return null;
}

/** Уже оценивал это дело — по другой ссылке или до перегенерации токена. */
async function alreadyReviewed(env: Env, deedId: string, viewerId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 AS hit FROM reviews WHERE deed_id = ?1 AND reviewer_user_id = ?2',
  )
    .bind(deedId, viewerId)
    .first<{ hit: number }>();
  return row !== null;
}

export async function getReview(env: Env, viewer: UserRow, token: string): Promise<Response> {
  const ctx = await loadToken(env, token);
  if (!ctx) throw notFound('link_invalid');

  const problem = linkProblem(ctx, viewer, sqlNow());
  if (problem) throw new HttpError(410, problem);
  if (await alreadyReviewed(env, ctx.deed.id, viewer.id)) {
    throw new HttpError(410, 'already_reviewed_by_you');
  }

  return json({
    deed: {
      description: ctx.deed.description,
      category: ctx.deed.category,
      effortLevel: ctx.deed.effort_level,
      baseScore: ctx.deed.base_score,
      createdAt: ctx.deed.created_at,
    },
    author: { firstName: ctx.author_first_name, photoUrl: ctx.author_photo_url },
    anchors: REVIEW_ANCHORS,
    maxScore: MAX_REVIEW_SCORE,
    expiresAt: ctx.expires_at,
  });
}

/**
 * Вставка оценки с разбором нарушения уникальности.
 *
 * Проверка «не оценивал ли уже» выше по коду отвечает за внятный текст, но
 * между ней и записью помещается второй сабмит того же человека по другой
 * ссылке. Ловит его индекс `(deed_id, reviewer_user_id)`; без этого разбора
 * гонка возвращала бы 500 вместо объяснения.
 */
async function insertReview(env: Env, statements: D1PreparedStatement[]) {
  try {
    return await env.DB.batch(statements);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed: reviews\.deed_id, reviews\.reviewer_user_id/.test(text)) {
      throw new HttpError(410, 'already_reviewed_by_you');
    }
    throw error;
  }
}

interface SubmitBody {
  score?: unknown;
  comment?: unknown;
}

export async function submitReview(
  request: Request,
  env: Env,
  reviewer: UserRow,
  token: string,
): Promise<Response> {
  const body = await readJson<SubmitBody>(request);
  if (!isValidScore(body.score)) throw badRequest('invalid_score');
  const comment =
    typeof body.comment === 'string' ? body.comment.trim().slice(0, REVIEW_COMMENT_MAX_LENGTH) : null;

  const ctx = await loadToken(env, token);
  if (!ctx) throw notFound('link_invalid');
  const now = sqlNow();

  const problem = linkProblem(ctx, reviewer, now);
  if (problem) throw new HttpError(410, problem);
  if (await alreadyReviewed(env, ctx.deed.id, reviewer.id)) {
    throw new HttpError(410, 'already_reviewed_by_you');
  }

  // INSERT ... SELECT: условие «токен ещё свободен» — часть самой вставки,
  // поэтому между проверкой и записью нельзя вклиниться. Гашение токена идёт
  // следом в той же транзакции; UNIQUE(deed_id, reviewer_slot) страхует сверху.
  const [inserted] = await insertReview(env, [
    env.DB.prepare(
      `INSERT INTO reviews (deed_id, reviewer_slot, score, comment, submitted_at, reviewer_user_id)
       SELECT deed_id, reviewer_slot, ?1, ?2, ?3, ?5 FROM review_tokens
       WHERE token = ?4 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?3`,
    ).bind(body.score, comment, now, token, reviewer.id),
    env.DB.prepare(
      `UPDATE review_tokens SET used_at = ?1
       WHERE token = ?2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?1`,
    ).bind(now, token),
  ]);

  // Ноль вставленных строк = между чтением и записью кто-то успел раньше.
  if ((inserted.meta?.changes ?? 0) === 0) throw new HttpError(410, 'link_used');

  return json(await settleDeed(env, ctx.deed.id, now));
}

/**
 * Агрегация. Срабатывает, когда оценок стало столько, сколько слотов.
 *
 * Обе гонящиеся записи могут увидеть «оценок хватает» одновременно, поэтому
 * начисление кармы и перевод дела в approved идут одним батчем и оба
 * условны по статусу дела: применится ровно одна пара.
 */
async function settleDeed(env: Env, deedId: string, now: string) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM reviews WHERE deed_id = ?1 ORDER BY reviewer_slot',
  )
    .bind(deedId)
    .all<ReviewRow>();
  const reviews = results ?? [];

  if (reviews.length < REVIEWER_SLOTS.length) {
    await env.DB.prepare(
      `UPDATE deeds SET status = 'partially_reviewed' WHERE id = ?1 AND status = 'pending'`,
    )
      .bind(deedId)
      .run();
    return { status: 'recorded', reviewsSubmitted: reviews.length, finalScore: null };
  }

  const deed = await env.DB.prepare('SELECT * FROM deeds WHERE id = ?1')
    .bind(deedId)
    .first<DeedRow>();
  if (!deed) throw notFound('deed_not_found');
  if (deed.status === 'approved') {
    return { status: 'approved', reviewsSubmitted: reviews.length, finalScore: deed.final_score };
  }

  const author = await getUserById(env.DB, deed.user_id);
  if (!author) throw notFound('author_not_found');

  const finalScore = aggregateScore(reviews.map((r) => r.score));
  const update = applyApproval(author, finalScore, Math.floor(Date.now() / 1000));

  // Разовый бонус причитается, только если автора кто-то пригласил и за него
  // ещё не платили. Дальше это число просто прибавляется в SQL.
  const joinBonus =
    author.referred_by !== null && author.referral_bonus_paid_at === null
      ? REFERRAL_JOIN_BONUS
      : 0;

  // Условие «дело ещё не подтверждено» повторяется в каждом операторе, а сам
  // перевод дела идёт последним: пока он не выполнен, все проверки видят
  // прежний статус. Так вся пачка применяется ровно один раз даже в гонке —
  // включая выплаты пригласившему, где двойное срабатывание значило бы
  // двойной бонус.
  const unsettled = `EXISTS (
    SELECT 1 FROM deeds WHERE id = ?9 AND status IN ('pending','partially_reviewed')
  )`;

  await env.DB.batch([
    // Юзер обновляется первым: после перевода дела в approved условие уже
    // не выполнится — транзакция видит собственные записи.
    env.DB.prepare(
      `UPDATE users SET karma_total = karma_total + ?1, level = ?2, badges = ?3
       WHERE id = ?4 AND ${unsettled.replace('?9', '?5')}`,
    ).bind(finalScore, update.level, encodeBadges(update.badges), author.id, deedId),

    // Доля и бонус пригласившему. Арифметика живёт в SQL, а не в коде:
    // читать копилку и писать её обратно значило бы потерять начисление,
    // если два дела разных приглашённых подтвердят одновременно.
    // Сотые от процента — это ровно final_score * REFERRAL_SHARE_PERCENT.
    env.DB.prepare(
      // CAST на КАЖДОМ параметре, а не только на делителе: D1 передаёт числа
      // вещественными, и `/` тогда делит вещественно — 50/100 давало 0.5,
      // а карма уезжала в дробь (10.5 вместо 10).
      `UPDATE users SET
         referral_fraction = (referral_fraction + CAST(?1 AS INTEGER)) % CAST(?2 AS INTEGER),
         karma_referral = karma_referral
           + (referral_fraction + CAST(?1 AS INTEGER)) / CAST(?2 AS INTEGER)
           + CAST(?3 AS INTEGER),
         karma_total = karma_total
           + (referral_fraction + CAST(?1 AS INTEGER)) / CAST(?2 AS INTEGER)
           + CAST(?3 AS INTEGER)
       WHERE id = ?4 AND ${unsettled.replace('?9', '?5')}`,
    ).bind(
      finalScore * REFERRAL_SHARE_PERCENT,
      HUNDREDTHS_PER_POINT,
      joinBonus,
      author.referred_by ?? 0,
      deedId,
    ),

    // Отметка «бонус за этого человека выплачен» — на приглашённом, чтобы
    // «один бонус за одного» проверялось одной строкой.
    env.DB.prepare(
      `UPDATE users SET referral_bonus_paid_at = ?1
       WHERE id = ?2 AND referral_bonus_paid_at IS NULL AND referred_by IS NOT NULL
         AND ${unsettled.replace('?9', '?3')}`,
    ).bind(now, author.id, deedId),

    env.DB.prepare(
      `UPDATE deeds SET final_score = ?1, status = 'approved', resolved_at = ?2
       WHERE id = ?3 AND status IN ('pending','partially_reviewed')`,
    ).bind(finalScore, now, deedId),
  ]);

  return { status: 'approved', reviewsSubmitted: reviews.length, finalScore };
}
