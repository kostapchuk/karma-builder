/**
 * Форма ответов Worker'а. Держится вручную в паре с `workers/src/routes/*`:
 * генератор ради дюжины маршрутов — лишняя машинерия.
 */

import type { ReviewerSlot } from '../karma/review';
import type { Badge, DeedCategory, EffortLevel } from '../karma/types';

export type DeedStatus =
  | 'pending'
  | 'partially_reviewed'
  | 'approved'
  | 'rejected'
  | 'expired';

export type SlotState = 'none' | 'waiting' | 'expired' | 'reviewed';

export interface SlotView {
  slot: ReviewerSlot;
  state: SlotState;
  url: string | null;
  expiresAt: string | null;
  score: number | null;
  comment: string | null;
}

export interface DeedView {
  id: string;
  description: string;
  category: DeedCategory;
  effortLevel: EffortLevel;
  /** эвристика V1: столько дело стоит «по прайсу», до ревью */
  baseScore: number;
  /** среднее двух оценок; null, пока дело не подтверждено */
  finalScore: number | null;
  status: DeedStatus;
  localDate: string;
  createdAt: string;
  resolvedAt: string | null;
  slots: SlotView[];
}

export interface Profile {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  /** подтверждённая ревью — другой кармы не бывает */
  karmaTotal: number;
  level: number;
  levelTitle: string;
  currentLevelXp: number;
  xpToNextLevel: number;
  streak: number;
  longestStreak: number;
  deedCount: number;
  /** в порядке DEED_CATEGORIES */
  categoryCounts: number[];
  badges: Badge[];
}

export interface MeResponse {
  profile: Profile;
  inviteLink: string | null;
  counts: { pending: number; approved: number };
  referrals: ReferralSummary;
}

export interface DeedsResponse {
  deeds: DeedView[];
  hasMore: boolean;
}

export interface CreateDeedResponse {
  deed: DeedView;
  profile: Profile;
  newBadges: Badge[];
}

export interface ReviewLink {
  slot: ReviewerSlot;
  url: string;
  expiresAt: string;
}

export interface SendReviewResponse {
  links: ReviewLink[];
  deed: DeedView;
}

export interface LeaderboardEntry {
  rank: number;
  id: number;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  karmaTotal: number;
  level: number;
  levelTitle: string;
  isMe: boolean;
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  me: { id: number; rank: number; karmaTotal: number } | null;
  hasMore?: boolean;
}

export interface FriendProfileResponse {
  profile: {
    id: number;
    username: string | null;
    firstName: string | null;
    photoUrl: string | null;
    karmaTotal: number;
    level: number;
    levelTitle: string;
    deedCount: number;
    longestStreak: number;
    badges: Badge[];
  };
}

/** D1 отдаёт время строкой `YYYY-MM-DD HH:MM:SS` в UTC. */
export function sqlToEpoch(value: string): number {
  const parsed = Date.parse(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

/** Балл, который стоит показать: подтверждённый, иначе предварительный. */
export function displayScore(deed: DeedView): number {
  return deed.finalScore ?? deed.baseScore;
}

/** Дело чужими глазами: то, что видит рецензент, придя по ссылке. */
/** Сводка по приглашённым: их всего, дошедших до подтверждения, и что принесли. */
export interface ReferralSummary {
  invited: number;
  active: number;
  karma: number;
}

export interface ReviewPageResponse {
  deed: {
    description: string;
    category: DeedCategory;
    effortLevel: EffortLevel;
    baseScore: number;
    createdAt: string;
  };
  author: { firstName: string | null; photoUrl: string | null };
  anchors: { example: string; short: string; score: number }[];
  maxScore: number;
  expiresAt: string;
}

export interface SubmitReviewResponse {
  status: 'recorded' | 'approved';
  reviewsSubmitted: number;
  finalScore: number | null;
}
