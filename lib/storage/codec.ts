/**
 * Компактная сериализация под лимит CloudStorage: значение ≤ 4096 символов.
 *
 * Дело едет кортежем, а не объектом — имена полей в JSON заняли бы больше,
 * чем сами данные. Категория — индексом в DEED_CATEGORIES, время — epoch seconds.
 */

import { DEED_CATEGORIES } from '../karma/scoring';
import type {
  Badge,
  CategoryCounts,
  Deed,
  DeedCategory,
  EffortLevel,
  Streak,
} from '../karma/types';
import { EMPTY_STREAK } from '../karma/streak';

export const SCHEMA_VERSION = 1;

/** [id, createdAt, categoryIndex, effortLevel, karmaPoints, description] */
type DeedTuple = [string, number, number, number, number, string];

export function encodeDeed(deed: Deed): DeedTuple {
  return [
    deed.id,
    deed.createdAt,
    DEED_CATEGORIES.indexOf(deed.category),
    deed.effortLevel,
    deed.karmaPoints,
    deed.description,
  ];
}

export function decodeDeed(tuple: DeedTuple): Deed | null {
  if (!Array.isArray(tuple) || tuple.length < 6) return null;
  const [id, createdAt, categoryIndex, effortLevel, karmaPoints, description] = tuple;
  const category = DEED_CATEGORIES[categoryIndex];
  if (!category) return null;
  return {
    id: String(id),
    createdAt: Number(createdAt),
    category: category as DeedCategory,
    effortLevel: (effortLevel as EffortLevel) ?? 1,
    karmaPoints: Number(karmaPoints),
    description: String(description ?? ''),
  };
}

export function encodeChunk(deeds: Deed[]): string {
  return JSON.stringify(deeds.map(encodeDeed));
}

/** Лимит значения в CloudStorage — 4096 символов. */
export const VALUE_MAX_LENGTH = 4096;
/** Запас к лимиту: следующий кортеж дела не должен вылезти за границу. */
export const CHUNK_MAX_LENGTH = VALUE_MAX_LENGTH - 300;
/** Верхняя граница по количеству — чтобы чанк оставался дешёвым для перезаписи. */
export const CHUNK_MAX_DEEDS = 25;

/**
 * Помещается ли чанк в один ключ. Правило вынесено сюда, а не в repository,
 * чтобы его можно было проверить без Telegram-окружения.
 */
export function chunkFits(encoded: string, deedCount: number): boolean {
  return deedCount <= CHUNK_MAX_DEEDS && encoded.length <= CHUNK_MAX_LENGTH;
}

export function decodeChunk(raw: string | undefined | null): Deed[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(decodeDeed).filter((d): d is Deed => d !== null);
  } catch {
    return [];
  }
}

/**
 * Агрегированное состояние — единственное, что переписывается на каждое дело
 * вместе с «горячим» чанком. Счётчики (deedCount / lastChunk) держим здесь же,
 * а не в отдельном ключе: иначе на каждое дело было бы три записи вместо двух.
 */
export interface PersistedState {
  totalKarma: number;
  updatedAt: number;
  streak: Streak;
  badges: Badge[];
  categoryCounts: CategoryCounts;
  deedCount: number;
  /** индекс последнего («горячего») чанка */
  lastChunk: number;
}

export function emptyState(): PersistedState {
  return {
    totalKarma: 0,
    updatedAt: 0,
    streak: { ...EMPTY_STREAK },
    badges: [],
    categoryCounts: DEED_CATEGORIES.map(() => 0),
    deedCount: 0,
    lastChunk: 0,
  };
}

export function encodeState(state: PersistedState): string {
  return JSON.stringify({
    k: state.totalKarma,
    u: state.updatedAt,
    s: [state.streak.currentStreak, state.streak.longestStreak, state.streak.lastDeedDate],
    b: state.badges.map((b) => [b.code, b.earnedAt]),
    c: state.categoryCounts,
    n: state.deedCount,
    l: state.lastChunk,
  });
}

export function decodeState(raw: string | undefined | null): PersistedState {
  if (!raw) return emptyState();
  try {
    const o = JSON.parse(raw);
    const base = emptyState();
    const streakTuple: unknown[] = Array.isArray(o.s) ? o.s : [];
    return {
      totalKarma: Number(o.k) || 0,
      updatedAt: Number(o.u) || 0,
      streak: {
        currentStreak: Number(streakTuple[0]) || 0,
        longestStreak: Number(streakTuple[1]) || 0,
        lastDeedDate: typeof streakTuple[2] === 'string' ? streakTuple[2] : '',
      },
      badges: Array.isArray(o.b)
        ? o.b
            .filter((x: unknown): x is [string, number] => Array.isArray(x) && x.length >= 1)
            .map(([code, earnedAt]: [string, number]) => ({
              code: String(code),
              earnedAt: Number(earnedAt) || 0,
            }))
        : [],
      // Категории могли дописаться в новой версии — добиваем нулями до текущей длины.
      categoryCounts: base.categoryCounts.map((_, i) =>
        Array.isArray(o.c) ? Number(o.c[i]) || 0 : 0,
      ),
      deedCount: Number(o.n) || 0,
      lastChunk: Number(o.l) || 0,
    };
  } catch {
    return emptyState();
  }
}

export interface PersistedMeta {
  schemaVersion: number;
}

export function encodeMeta(meta: PersistedMeta): string {
  return JSON.stringify({ v: meta.schemaVersion });
}

export function decodeMeta(raw: string | undefined | null): PersistedMeta | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return { schemaVersion: Number(o.v) || SCHEMA_VERSION };
  } catch {
    return null;
  }
}
