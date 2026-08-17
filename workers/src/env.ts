export interface Env {
  DB: D1Database;
  /** Секрет бота: wrangler secret put BOT_TOKEN. В бандл не попадает. */
  BOT_TOKEN: string;
  REVIEW_BASE_URL: string;
  ALLOWED_ORIGINS: string;
  REVIEW_TTL_HOURS: string;
  /** username бота без @ — из него собирается ссылка-приглашение в друзья */
  BOT_USERNAME: string;
  /** Потолок числа зарегистрированных: пусто или 0 — без ограничения. */
  MAX_USERS?: string;
}

export function reviewTtlHours(env: Env): number {
  const parsed = Number(env.REVIEW_TTL_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 72;
}

/**
 * Сколько человек пускаем. Ноль — и любое неразобранное значение — означает
 * «сколько угодно»: иначе опечатка в переменной закрыла бы вход всем.
 *
 * Ограничение только на регистрацию: уже заведённые продолжают работать, даже
 * если потолок опустили ниже их числа.
 */
export function maxUsers(env: Env): number {
  const parsed = Number(env.MAX_USERS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}
