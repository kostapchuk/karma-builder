/** Строки `deeds`, `review_tokens`, `reviews` и их сборка в ответ клиенту. */

import { DEED_CATEGORIES } from '../../../lib/karma/scoring';
import type { DeedCategory, EffortLevel } from '../../../lib/karma/types';
import type { Env } from '../env';
import { isExpired, sqlNow } from '../lib/time';

export type DeedStatus =
  | 'pending'
  | 'partially_reviewed'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'legacy_unverified';

export interface DeedRow {
  id: string;
  user_id: number;
  description: string;
  category: string;
  effort_level: number;
  base_score: number;
  final_score: number | null;
  status: DeedStatus;
  local_date: string;
  created_at: string;
  resolved_at: string | null;
}

export interface TokenRow {
  token: string;
  deed_id: string;
  reviewer_slot: number;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

export interface ReviewRow {
  id: number;
  deed_id: string;
  reviewer_slot: number;
  score: number;
  comment: string | null;
  submitted_at: string;
}

/** Состояние слота глазами автора дела. */
export type SlotState = 'none' | 'waiting' | 'expired' | 'reviewed';

export interface SlotView {
  slot: 1 | 2;
  state: SlotState;
  url: string | null;
  expiresAt: string | null;
  score: number | null;
  comment: string | null;
}

export const isDeedCategory = (value: unknown): value is DeedCategory =>
  typeof value === 'string' && (DEED_CATEGORIES as readonly string[]).includes(value);

export const isEffortLevel = (value: unknown): value is EffortLevel =>
  value === 1 || value === 2 || value === 3;

export const reviewUrl = (env: Env, token: string) =>
  `${env.REVIEW_BASE_URL.replace(/\/$/, '')}/r/${token}`;

function slotView(
  env: Env,
  slot: 1 | 2,
  token: TokenRow | undefined,
  review: ReviewRow | undefined,
  now: string,
): SlotView {
  if (review) {
    return {
      slot,
      state: 'reviewed',
      url: null,
      expiresAt: null,
      score: review.score,
      comment: review.comment,
    };
  }
  if (!token || token.revoked_at) {
    return { slot, state: 'none', url: null, expiresAt: null, score: null, comment: null };
  }
  // used_at без строки в reviews — обрыв между шагами; ссылку считаем истёкшей,
  // чтобы автор мог перегенерировать её и не застрять навсегда.
  const dead = token.used_at !== null || isExpired(token.expires_at, now);
  return {
    slot,
    state: dead ? 'expired' : 'waiting',
    url: dead ? null : reviewUrl(env, token.token),
    expiresAt: token.expires_at,
    score: null,
    comment: null,
  };
}

export function deedView(
  env: Env,
  deed: DeedRow,
  tokens: TokenRow[],
  reviews: ReviewRow[],
  now: string = sqlNow(),
) {
  const slots: SlotView[] = ([1, 2] as const).map((slot) =>
    slotView(
      env,
      slot,
      tokens.find((t) => t.reviewer_slot === slot),
      reviews.find((r) => r.reviewer_slot === slot),
      now,
    ),
  );

  return {
    id: deed.id,
    description: deed.description,
    category: deed.category as DeedCategory,
    effortLevel: deed.effort_level as EffortLevel,
    baseScore: deed.base_score,
    finalScore: deed.final_score,
    status: deed.status,
    localDate: deed.local_date,
    createdAt: deed.created_at,
    resolvedAt: deed.resolved_at,
    slots,
  };
}

/**
 * Токены и оценки для пачки дел — двумя запросами, а не по запросу на дело.
 * Лимит переменных в D1 щедрый, а страница истории не длиннее сотни дел.
 */
export async function loadSlotData(
  db: D1Database,
  deedIds: string[],
): Promise<{ tokens: TokenRow[]; reviews: ReviewRow[] }> {
  if (deedIds.length === 0) return { tokens: [], reviews: [] };
  const placeholders = deedIds.map((_, i) => `?${i + 1}`).join(',');

  const [tokens, reviews] = await db.batch<TokenRow | ReviewRow>([
    db.prepare(`SELECT * FROM review_tokens WHERE deed_id IN (${placeholders})`).bind(...deedIds),
    db.prepare(`SELECT * FROM reviews WHERE deed_id IN (${placeholders})`).bind(...deedIds),
  ]);

  return {
    tokens: (tokens.results ?? []) as TokenRow[],
    reviews: (reviews.results ?? []) as ReviewRow[],
  };
}
