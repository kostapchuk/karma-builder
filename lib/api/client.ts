/**
 * HTTP-клиент Worker'а.
 *
 * Урок V1 переносится один в один: ответ на той стороне не гарантирован,
 * поэтому у каждого запроса свой таймаут. Там это был клиент Telegram,
 * здесь — сеть до Cloudflare; в webview на мобильном интернете разница
 * между «медленно» и «никогда» на глаз неразличима.
 */

'use client';

import { initDataRaw } from '@telegram-apps/sdk-react';

import { devInitData } from '../telegram/init';

import type {
  CreateDeedResponse,
  DeedView,
  DeedsResponse,
  FriendProfileResponse,
  LeaderboardResponse,
  MeResponse,
  ReviewPageResponse,
  SendReviewResponse,
  SubmitReviewResponse,
} from './types';
import type { DeedCategory, EffortLevel } from '../karma/types';

const BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8788').replace(/\/$/, '');

const TIMEOUT_MS = 12_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }

  /** Истёкший initData лечится перезапуском Mini App, а не повтором запроса. */
  get isAuthProblem(): boolean {
    return this.status === 401;
  }
}

function authHeader(): Record<string, string> {
  try {
    // Вне Telegram работает дев-мок: он подписывает initData локальным
    // токеном и отдаёт строку в точности такой, какой она была подписана.
    const raw = devInitData() ?? initDataRaw();
    return raw ? { 'X-Telegram-Init-Data': raw } : {};
  } catch {
    return {};
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...authHeader(),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'network');
  } finally {
    clearTimeout(timer);
  }

  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(response.status, payload.error ?? 'unknown');
  return payload as T;
}

/** Локальный день пользователя: сервер живёт в UTC и сам его не знает. */
function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export const api = {
  me: () => request<MeResponse>('GET', `/api/me?today=${todayKey()}`),

  deeds: (params: { status?: string[]; limit?: number } = {}) => {
    const query = new URLSearchParams();
    for (const status of params.status ?? []) query.append('status', status);
    query.set('limit', String(params.limit ?? 50));
    return request<DeedsResponse>('GET', `/api/deeds?${query.toString()}`);
  },

  createDeed: (input: {
    description: string;
    category: DeedCategory;
    effortLevel: EffortLevel;
  }) => request<CreateDeedResponse>('POST', '/api/deeds', { ...input, localDate: todayKey() }),

  // Одно дело по id: экран подробностей может открыться по прямой ссылке,
  // когда история в сторе ещё не загружена или дело в неё не попало.
  deed: (id: string) => request<{ deed: DeedView }>('GET', `/api/deeds/${id}`),

  sendReview: (deedId: string) =>
    request<SendReviewResponse>('POST', `/api/deeds/${deedId}/send-review`),

  // Ревью тоже требует initData: рецензент опознан, иначе автор подтверждал бы
  // собственные дела сам.
  reviewPage: (token: string) => request<ReviewPageResponse>('GET', `/api/review/${token}`),

  submitReview: (token: string, input: { score: number; comment?: string }) =>
    request<SubmitReviewResponse>('POST', `/api/review/${token}`, input),

  friendsLeaderboard: () => request<LeaderboardResponse>('GET', '/api/leaderboard/friends'),

  globalLeaderboard: (limit = 50) =>
    request<LeaderboardResponse>('GET', `/api/leaderboard/global?limit=${limit}`),

  friendProfile: (id: number) => request<FriendProfileResponse>('GET', `/api/users/${id}`),

  addFriend: (ref: string) => request<{ friend: { id: number } }>('POST', '/api/friends/add', { ref }),

};
