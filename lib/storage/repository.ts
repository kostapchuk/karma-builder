/**
 * Раскладка данных поверх KV-драйвера.
 *
 *   meta      — schemaVersion, пишется один раз (для будущих миграций)
 *   state     — карма, стрик, бейджи, счётчики; переписывается на каждое дело
 *   d0, d1, … — чанки дел, ~20 дел на чанк; старые чанки иммутабельны
 *
 * Запись дела = 2 setItem (горячий чанк + state). Чтение на старте = state
 * + горячий чанк, остальные чанки грузятся лениво при открытии History.
 */

import { levelForXp } from '../karma/scoring';
import { evaluateNewBadges } from '../karma/badges';
import { applyDeedToStreak, dateKeyFromEpochSeconds } from '../karma/streak';
import type { Badge, Deed } from '../karma/types';
import { DEED_CATEGORIES } from '../karma/scoring';
import {
  PersistedState,
  SCHEMA_VERSION,
  chunkFits,
  decodeChunk,
  decodeMeta,
  decodeState,
  emptyState,
  encodeChunk,
  encodeMeta,
  encodeState,
} from './codec';
import { createDriver, storageKind } from './driver';
import type { StorageKind } from './driver';

const KEY_META = 'meta';
const KEY_STATE = 'state';

export const chunkKey = (index: number) => `d${index}`;

/** Сколько дел показываем на Home. */
export const RECENT_DEEDS_LIMIT = 5;

export interface HeadSnapshot {
  state: PersistedState;
  recentDeeds: Deed[];
  storageKind: StorageKind;
}

export interface AppendResult {
  deed: Deed;
  state: PersistedState;
  previousLevel: number;
  newLevel: number;
  newBadges: Badge[];
}

async function readState(): Promise<PersistedState> {
  const driver = createDriver();
  const raw = await driver.getItems([KEY_STATE]);
  return decodeState(raw[KEY_STATE]);
}

/**
 * Старт приложения: тянем state и «хвост» дел для Home.
 * Если в горячем чанке меньше пяти дел — добираем предыдущий.
 */
export async function loadHead(): Promise<HeadSnapshot> {
  const driver = createDriver();
  const head = await driver.getItems([KEY_META, KEY_STATE, chunkKey(0)]);

  // Первый запуск: проставляем schemaVersion, чтобы будущие миграции знали,
  // с какой раскладкой имеют дело.
  if (!decodeMeta(head[KEY_META])) {
    await driver.setItem(KEY_META, encodeMeta({ schemaVersion: SCHEMA_VERSION }));
  }

  const state = decodeState(head[KEY_STATE]);

  let recent: Deed[] =
    state.lastChunk === 0 ? decodeChunk(head[chunkKey(0)]) : decodeChunk(
      (await driver.getItems([chunkKey(state.lastChunk)]))[chunkKey(state.lastChunk)],
    );

  if (recent.length < RECENT_DEEDS_LIMIT && state.lastChunk > 0) {
    const prevKey = chunkKey(state.lastChunk - 1);
    const prev = decodeChunk((await driver.getItems([prevKey]))[prevKey]);
    recent = [...prev, ...recent];
  }

  return {
    state,
    recentDeeds: sortNewestFirst(recent).slice(0, RECENT_DEEDS_LIMIT),
    // Спрашиваем после чтения: CloudStorage мог отвалиться прямо на нём.
    storageKind: storageKind(),
  };
}

/** Ленивая загрузка всей истории — только при открытии History. */
export async function loadAllDeeds(lastChunk: number): Promise<Deed[]> {
  const driver = createDriver();
  const keys = Array.from({ length: lastChunk + 1 }, (_, i) => chunkKey(i));
  const raw = await driver.getItems(keys);
  const deeds = keys.flatMap((key) => decodeChunk(raw[key]));
  return sortNewestFirst(deeds);
}

/**
 * Добавление дела.
 *
 * Транзакций в CloudStorage нет, семантика last-write-wins. Поэтому state
 * перечитываем непосредственно перед записью: иначе дело, добавленное со
 * второго устройства, затёрлось бы устаревшим счётчиком чанка.
 *
 * `chunkHint` — номер горячего чанка из памяти store. Он позволяет запросить
 * `state` и сам чанк одним вызовом вместо двух последовательных: каждое
 * обращение к CloudStorage идёт через клиент Telegram и стоит заметной паузы.
 * Подсказка может устареть (дело добавили со второго устройства) — тогда
 * дочитываем правильный чанк, то есть в худшем случае столько же вызовов,
 * сколько было раньше.
 */
export async function appendDeed(deed: Deed, chunkHint = 0): Promise<AppendResult> {
  const driver = createDriver();

  const hintKey = chunkKey(chunkHint);
  const head = await driver.getItems([KEY_STATE, hintKey]);
  const state = decodeState(head[KEY_STATE]);

  const hotKey = chunkKey(state.lastChunk);
  const hotDeeds =
    state.lastChunk === chunkHint
      ? decodeChunk(head[hintKey])
      : decodeChunk((await driver.getItems([hotKey]))[hotKey]);

  const candidate = [...hotDeeds, deed];
  const candidateEncoded = encodeChunk(candidate);
  // Старые чанки иммутабельны: как только текущий заполнился — заводим следующий.
  const fits = chunkFits(candidateEncoded, candidate.length);

  const targetChunk = fits ? state.lastChunk : state.lastChunk + 1;
  const payload = fits ? candidateEncoded : encodeChunk([deed]);

  const previousLevel = levelForXp(state.totalKarma);
  const totalKarma = state.totalKarma + deed.karmaPoints;
  const newLevel = levelForXp(totalKarma);

  const categoryCounts = [...state.categoryCounts];
  const categoryIndex = DEED_CATEGORIES.indexOf(deed.category);
  if (categoryIndex >= 0) {
    categoryCounts[categoryIndex] = (categoryCounts[categoryIndex] ?? 0) + 1;
  }

  const streak = applyDeedToStreak(state.streak, dateKeyFromEpochSeconds(deed.createdAt));
  const deedCount = state.deedCount + 1;

  const newBadges = evaluateNewBadges(
    state.badges,
    { deedCount, level: newLevel, streak, categoryCounts },
    deed.createdAt,
  );

  const nextState: PersistedState = {
    totalKarma,
    updatedAt: deed.createdAt,
    streak,
    badges: [...state.badges, ...newBadges],
    categoryCounts,
    deedCount,
    lastChunk: targetChunk,
  };

  // Сначала чанк, потом state: если второй записать не успеем, дело
  // останется на диске и восстановится пересчётом, а не потеряется.
  await driver.setItem(chunkKey(targetChunk), payload);
  await driver.setItem(KEY_STATE, encodeState(nextState));

  return { deed, state: nextState, previousLevel, newLevel, newBadges };
}

/** Полный сброс (кнопка в Profile). */
export async function resetAll(): Promise<void> {
  const driver = createDriver();
  const state = await readState();
  const keys = [
    KEY_META,
    KEY_STATE,
    ...Array.from({ length: state.lastChunk + 1 }, (_, i) => chunkKey(i)),
  ];
  await driver.deleteItems(keys);
}

export function sortNewestFirst(deeds: Deed[]): Deed[] {
  return [...deeds].sort((a, b) => b.createdAt - a.createdAt);
}

export function emptyHead(): HeadSnapshot {
  return { state: emptyState(), recentDeeds: [], storageKind: 'local' };
}
