export interface Env {
  DB: D1Database;
  /** Секрет бота: wrangler secret put BOT_TOKEN. В бандл не попадает. */
  BOT_TOKEN: string;
  REVIEW_BASE_URL: string;
  ALLOWED_ORIGINS: string;
  REVIEW_TTL_HOURS: string;
  /** username бота без @ — из него собирается ссылка-приглашение в друзья */
  BOT_USERNAME: string;
}

export function reviewTtlHours(env: Env): number {
  const parsed = Number(env.REVIEW_TTL_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 72;
}
