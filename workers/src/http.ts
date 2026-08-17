/** Ответы, ошибки и CORS. Ничего специфичного для домена. */

import type { Env } from './env';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    /** машинный код: клиент разбирает его, а не текст */
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, message?: string) => new HttpError(400, code, message);
export const unauthorized = (code: string) => new HttpError(401, code);
export const notFound = (code = 'not_found') => new HttpError(404, code);
export const conflict = (code: string) => new HttpError(409, code);

/**
 * CORS. Приватные маршруты авторизуются заголовком `X-Telegram-Init-Data`,
 * а не cookie, поэтому «*» безопасно: чужая страница не подделает initData.
 * Кастомный заголовок делает запросы непростыми — preflight обязателен.
 */
export function corsHeaders(env: Env, request: Request): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim());
  const origin = request.headers.get('Origin');
  const allowOrigin =
    allowed.includes('*') ? '*' : origin && allowed.includes(origin) ? origin : allowed[0] ?? '*';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.code, message: error.message }, { status: error.status });
  }
  console.error('[worker] unhandled', error);
  return json({ error: 'internal' }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') throw badRequest('invalid_body');
    return body as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw badRequest('invalid_json');
  }
}
