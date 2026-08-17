/**
 * Форма ответов Worker'а. Держится вручную в паре с `workers/src/routes/*`:
 * генератор ради дюжины маршрутов — лишняя машинерия.
 */

import type { Badge, DeedCategory, EffortLevel } from '../karma/types';

export type DeedStatus =
  | 'pending'
  | 'partially_reviewed'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'legacy_unverified';

export type SlotState = 'none' | 'waiting' | 'expired' | 'reviewed';

export interface SlotView {
  slot: 1 | 2;
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
  /** подтверждённая ревью — только она идёт в лидерборды */
  karmaTotal: number;
  /** самооценённая, перенесённая из V1 */
  karmaSelfTotal: number;
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
  legacyImported: boolean;
}

export interface MeResponse {
  profile: Profile;
  inviteLink: string | null;
  counts: { pending: number; approved: number; legacy: number };
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
  slot: 1 | 2;
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

export interface ImportLegacyResponse {
  imported: number;
  skipped?: number;
  karmaSelfTotal?: number;
  newBadges?: Badge[];
  profile: Profile;
  alreadyImported: boolean;
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
