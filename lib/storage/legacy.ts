/**
 * Чтение истории V1 из CloudStorage — только для одноразового импорта в D1.
 *
 * Отдельно от repository.ts намеренно: тот при чтении дописывает `meta`,
 * а импорту нужно строго read-only. Раскладку не трогаем — она описана
 * в docs/v1-status.md и должна пережить переезд без изменений.
 */

'use client';

import { DEED_CATEGORIES } from '../karma/scoring';
import { dateKeyFromEpochSeconds } from '../karma/streak';
import { decodeChunk, decodeState } from './codec';
import { createDriver } from './driver';
import { chunkKey } from './repository';

/** Дело в том виде, в каком его ждёт `/api/import/legacy`. */
export interface LegacyDeedPayload {
  id: string;
  description: string;
  category: string;
  effortLevel: number;
  /** посчитано ещё в V1: пересчитывать по текущим весам нельзя */
  karmaPoints: number;
  createdAt: number;
  /** день в зоне пользователя — иначе стрик после импорта разъедется */
  localDate: string;
}

export interface LegacySnapshot {
  deeds: LegacyDeedPayload[];
  totalKarma: number;
}

export async function readLegacySnapshot(): Promise<LegacySnapshot> {
  const driver = createDriver();

  const head = await driver.getItems(['state']);
  const state = decodeState(head.state);
  if (state.deedCount === 0 && state.totalKarma === 0) {
    return { deeds: [], totalKarma: 0 };
  }

  // Число чанков берём из state.lastChunk, а не из meta: в V1 счётчики
  // переехали в state (расхождение 1 в docs/v1-status.md).
  const keys = Array.from({ length: state.lastChunk + 1 }, (_, i) => chunkKey(i));
  const raw = await driver.getItems(keys);

  const deeds = keys
    .flatMap((key) => decodeChunk(raw[key]))
    .map((deed) => ({
      id: deed.id,
      description: deed.description,
      category: deed.category,
      effortLevel: deed.effortLevel,
      karmaPoints: deed.karmaPoints,
      createdAt: deed.createdAt,
      localDate: dateKeyFromEpochSeconds(deed.createdAt),
    }))
    .filter((deed) => (DEED_CATEGORIES as readonly string[]).includes(deed.category));

  return { deeds, totalKarma: state.totalKarma };
}
