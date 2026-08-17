/** Клиент API ревью. Единственный внешний адрес — Worker. */

import type { ScoreAnchor } from '../../lib/karma/review';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8788').replace(/\/$/, '');

export interface ReviewPage {
  deed: {
    description: string;
    category: string;
    effortLevel: 1 | 2 | 3;
    baseScore: number;
    createdAt: string;
  };
  author: { firstName: string | null; photoUrl: string | null };
  anchors: ScoreAnchor[];
  maxScore: number;
  expiresAt: string;
}

export interface SubmitResult {
  status: 'recorded' | 'approved';
  reviewsSubmitted: number;
  finalScore: number | null;
}

/** Коды, по которым страница показывает разные экраны отказа. */
export type ApiErrorCode =
  | 'link_invalid'
  | 'link_used'
  | 'link_expired'
  | 'link_revoked'
  | 'deed_already_approved'
  | 'invalid_score'
  | 'network'
  | 'unknown';

export class ApiError extends Error {
  constructor(readonly code: ApiErrorCode) {
    super(code);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch {
    // Сеть у рецензента может быть какой угодно: он открывает ссылку из мессенджера.
    throw new ApiError('network');
  }

  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError((body.error as ApiErrorCode) ?? 'unknown');
  return body as T;
}

export const fetchReviewPage = (token: string) =>
  request<ReviewPage>(`/api/review/${encodeURIComponent(token)}`);

export const submitReview = (token: string, score: number, comment: string) =>
  request<SubmitResult>(`/api/review/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ score, comment: comment.trim() || undefined }),
  });
