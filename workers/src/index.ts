/**
 * Точка входа Worker'а. Роутер намеренно рукописный: маршрутов дюжина,
 * фреймворк добавил бы килобайты бандла и ничего не упростил.
 *
 * Приватные маршруты авторизуются заголовком `X-Telegram-Init-Data` — свежий
 * initData на каждый запрос, без сессий (см. auth/telegramAuth.ts).
 */

import { validateInitData } from './auth/telegramAuth';
import { upsertUser, type UserRow } from './data/users';
import type { Env } from './env';
import { corsHeaders, errorResponse, json, notFound, unauthorized } from './http';
import { createDeed, getDeed, listDeeds, sendReview } from './routes/deeds';
import { addFriend } from './routes/friends';
import { importLegacy } from './routes/importLegacy';
import { friendProfile, friendsLeaderboard, globalLeaderboard } from './routes/leaderboard';
import { getMe } from './routes/me';
import { getReview, submitReview } from './routes/review';

const INIT_DATA_HEADER = 'X-Telegram-Init-Data';

async function authenticate(request: Request, env: Env): Promise<UserRow> {
  const raw = request.headers.get(INIT_DATA_HEADER);
  if (!raw) throw unauthorized('init_data_missing');
  const initData = await validateInitData(raw, env.BOT_TOKEN);
  return upsertUser(env.DB, initData.user);
}

/** Для публичных маршрутов, которым свой юзер полезен, но не обязателен. */
async function authenticateOptional(request: Request, env: Env): Promise<UserRow | null> {
  if (!request.headers.get(INIT_DATA_HEADER)) return null;
  try {
    return await authenticate(request, env);
  } catch {
    return null;
  }
}

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;
  const segments = pathname.split('/').filter(Boolean);

  if (pathname === '/api/health') return json({ ok: true });

  // --- публичное: страница рецензента ---------------------------------------
  if (segments[0] === 'api' && segments[1] === 'review' && segments[2]) {
    if (method === 'GET') return getReview(env, segments[2]);
    if (method === 'POST') return submitReview(request, env, segments[2]);
  }

  if (pathname === '/api/leaderboard/global' && method === 'GET') {
    return globalLeaderboard(request, env, await authenticateOptional(request, env));
  }

  // --- приватное: только из Mini App ----------------------------------------
  if (pathname === '/api/me' && method === 'GET') {
    return getMe(request, env, await authenticate(request, env));
  }

  if (pathname === '/api/deeds') {
    if (method === 'POST') return createDeed(request, env, await authenticate(request, env));
    if (method === 'GET') return listDeeds(request, env, await authenticate(request, env));
  }

  if (segments[0] === 'api' && segments[1] === 'deeds' && segments[2]) {
    if (segments.length === 3 && method === 'GET') {
      return getDeed(env, await authenticate(request, env), segments[2]);
    }
    if (segments.length === 4 && segments[3] === 'send-review' && method === 'POST') {
      return sendReview(request, env, await authenticate(request, env), segments[2]);
    }
  }

  if (pathname === '/api/leaderboard/friends' && method === 'GET') {
    return friendsLeaderboard(env, await authenticate(request, env));
  }

  if (segments[0] === 'api' && segments[1] === 'users' && segments[2] && method === 'GET') {
    await authenticate(request, env);
    return friendProfile(env, Number(segments[2]));
  }

  if (pathname === '/api/friends/add' && method === 'POST') {
    return addFriend(request, env, await authenticate(request, env));
  }

  if (pathname === '/api/import/legacy' && method === 'POST') {
    return importLegacy(request, env, await authenticate(request, env));
  }

  throw notFound('route_not_found');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env, request);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    let response: Response;
    try {
      response = await route(request, env);
    } catch (error) {
      response = errorResponse(error);
    }

    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
