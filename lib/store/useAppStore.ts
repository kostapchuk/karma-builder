/**
 * Zustand — источник для UI, CloudStorage — источник правды на диске.
 * Store гидратируется один раз при старте и после этого держит агрегаты
 * в памяти, чтобы Home не ждал сети на каждый переход между экранами.
 */

'use client';

import { create } from 'zustand';
import { nanoid } from 'nanoid';

import { computeKarmaPoints } from '../karma/scoring';
import type { Badge, Deed, DeedCategory, EffortLevel } from '../karma/types';
import { PersistedState, emptyState } from '../storage/codec';
import { onStorageDegraded } from '../storage/driver';
import type { StorageKind } from '../storage/driver';
import {
  RECENT_DEEDS_LIMIT,
  appendDeed,
  loadAllDeeds,
  loadHead,
  resetAll,
  sortNewestFirst,
} from '../storage/repository';

export type HydrationStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Результат добавления дела — то, что экрану нужно отпраздновать. */
export interface AddDeedOutcome {
  deed: Deed;
  leveledUp: boolean;
  newLevel: number;
  newBadges: Badge[];
}

interface AppState {
  status: HydrationStatus;
  error: string | null;
  storageKind: StorageKind;

  state: PersistedState;
  recentDeeds: Deed[];

  /** Полная история грузится лениво, при первом открытии History. */
  deeds: Deed[];
  historyStatus: HydrationStatus;

  hydrate(): Promise<void>;
  addDeed(input: {
    description: string;
    category: DeedCategory;
    effortLevel: EffortLevel;
  }): Promise<AddDeedOutcome>;
  loadHistory(force?: boolean): Promise<void>;
  reset(): Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  status: 'idle',
  error: null,
  storageKind: 'local',
  state: emptyState(),
  recentDeeds: [],
  deeds: [],
  historyStatus: 'idle',

  async hydrate() {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading', error: null });
    // CloudStorage может отвалиться и позже, на первой же записи —
    // тогда баннер должен появиться без перезагрузки.
    onStorageDegraded(() => set({ storageKind: 'local' }));
    try {
      const head = await loadHead();
      set({
        status: 'ready',
        state: head.state,
        recentDeeds: head.recentDeeds,
        storageKind: head.storageKind,
      });
    } catch (error) {
      console.error('[store] hydrate failed', error);
      set({ status: 'error', error: 'Не удалось загрузить данные' });
    }
  },

  async addDeed({ description, category, effortLevel }) {
    const deed: Deed = {
      id: nanoid(8),
      description: description.trim(),
      category,
      effortLevel,
      karmaPoints: computeKarmaPoints(category, effortLevel),
      createdAt: Math.floor(Date.now() / 1000),
    };

    const result = await appendDeed(deed);

    set((prev) => ({
      state: result.state,
      recentDeeds: [deed, ...prev.recentDeeds].slice(0, RECENT_DEEDS_LIMIT),
      // Историю обновляем только если она уже загружена — иначе пусть
      // подтянется лениво целиком при открытии History.
      deeds: prev.historyStatus === 'ready' ? sortNewestFirst([deed, ...prev.deeds]) : prev.deeds,
    }));

    return {
      deed,
      leveledUp: result.newLevel > result.previousLevel,
      newLevel: result.newLevel,
      newBadges: result.newBadges,
    };
  },

  async loadHistory(force = false) {
    const { historyStatus, state } = get();
    if (!force && (historyStatus === 'loading' || historyStatus === 'ready')) return;
    set({ historyStatus: 'loading' });
    try {
      const deeds = await loadAllDeeds(state.lastChunk);
      set({ deeds, historyStatus: 'ready' });
    } catch (error) {
      console.error('[store] loadHistory failed', error);
      set({ historyStatus: 'error' });
    }
  },

  async reset() {
    await resetAll();
    set({
      state: emptyState(),
      recentDeeds: [],
      deeds: [],
      historyStatus: 'idle',
      status: 'ready',
      error: null,
    });
  },
}));
