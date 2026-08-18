/**
 * Zustand — источник для UI, D1 за Worker'ом — источник правды.
 *
 * Отличие от V1: карма больше не растёт в момент записи дела. Дело создаётся
 * со статусом `pending` и ждёт оценки посторонних, поэтому «праздновать» на экране
 * добавления нечего — уровень и бейджи приезжают позже, при обновлении профиля.
 * Отсюда `celebration`: то, что случилось между запусками, показывается на Home.
 */

'use client';

import { create } from 'zustand';

import { ApiError, api } from '../api/client';
import type {
  DeedView,
  LeaderboardEntry,
  Profile,
  ReferralSummary,
  ReviewLink,
} from '../api/types';
import type { Badge, DeedCategory, EffortLevel } from '../karma/types';
import { initDataStartParam } from '@telegram-apps/sdk-react';

export type HydrationStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Что показать на Home после того, как дела подтвердили без нас. */
export interface Celebration {
  level: number | null;
  badges: Badge[];
}

export interface AddDeedOutcome {
  deed: DeedView;
  newBadges: Badge[];
}

interface AppState {
  status: HydrationStatus;
  error: string | null;

  profile: Profile | null;
  inviteLink: string | null;
  counts: { pending: number; approved: number };
  referrals: ReferralSummary;
  deeds: DeedView[];
  celebration: Celebration | null;

  friends: LeaderboardEntry[] | null;
  global: LeaderboardEntry[] | null;
  globalMeRank: number | null;

  hydrate(force?: boolean): Promise<void>;
  refresh(): Promise<void>;
  addDeed(input: {
    description: string;
    category: DeedCategory;
    effortLevel: EffortLevel;
  }): Promise<AddDeedOutcome>;
  requestReviewLinks(deedId: string): Promise<ReviewLink[]>;
  loadLeaderboards(): Promise<void>;
  dismissCelebration(): void;
}

const SEEN_LEVEL_KEY = 'kb:seen-level';
const SEEN_BADGES_KEY = 'kb:seen-badges';

/**
 * Что изменилось с прошлого визита. Уровень и бейджи теперь приходят от
 * сервера в любой момент — «когда проверяющие дошли до дела», — поэтому отметку
 * о показанном держим на устройстве, а не выводим из ответа.
 */
function pickCelebration(profile: Profile): Celebration | null {
  if (typeof window === 'undefined') return null;

  const codes = profile.badges.map((b) => b.code);
  let seenLevel = 0;
  let seenBadges: string[] = [];
  try {
    seenLevel = Number(window.localStorage.getItem(SEEN_LEVEL_KEY) ?? '0');
    seenBadges = JSON.parse(window.localStorage.getItem(SEEN_BADGES_KEY) ?? '[]');
  } catch {
    seenLevel = 0;
    seenBadges = [];
  }

  // Первый запуск: ничего не празднуем, просто запоминаем текущее состояние.
  const first = seenLevel === 0 && seenBadges.length === 0;
  const newBadges = profile.badges.filter((b) => !seenBadges.includes(b.code));
  const leveledUp = !first && profile.level > seenLevel;

  try {
    window.localStorage.setItem(SEEN_LEVEL_KEY, String(profile.level));
    window.localStorage.setItem(SEEN_BADGES_KEY, JSON.stringify(codes));
  } catch {
    // Приватный режим — просто не покажем оверлей во второй раз.
  }

  if (first || (!leveledUp && newBadges.length === 0)) return null;
  return { level: leveledUp ? profile.level : null, badges: newBadges };
}

function message(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'network') return 'Нет связи с сервером';
    // Набор закрыт потолком MAX_USERS. Переоткрывать приложение бессмысленно,
    // поэтому и текст другой, чем у проблем со входом.
    if (error.code === 'signup_closed') {
      return 'Пока идёт закрытый запуск — мест больше нет. Попробуйте позже.';
    }
    if (error.isAuthProblem) return 'Telegram не подтвердил вход — переоткройте приложение';
  }
  return 'Не удалось загрузить данные';
}

export const useAppStore = create<AppState>((set, get) => ({
  status: 'idle',
  error: null,
  profile: null,
  inviteLink: null,
  counts: { pending: 0, approved: 0 },
  referrals: { invited: 0, active: 0, karma: 0 },
  deeds: [],
  celebration: null,
  friends: null,
  global: null,
  globalMeRank: null,

  async hydrate(force = false) {
    const current = get().status;
    if (!force && (current === 'loading' || current === 'ready')) return;
    set({ status: 'loading', error: null });

    try {
      const [me, history] = await Promise.all([api.me(), api.deeds({ limit: 50 })]);

      set({
        status: 'ready',
        profile: me.profile,
        inviteLink: me.inviteLink,
        counts: me.counts,
        referrals: me.referrals,
        deeds: history.deeds,
        celebration: pickCelebration(me.profile),
      });

      // Дальше — фоновые задачи. Они не должны мешать экрану: сорвались —
      // приложение всё равно работает.
      void adoptFriendFromDeepLink();
    } catch (error) {
      console.error('[store] hydrate failed', error);
      set({ status: 'error', error: message(error) });
    }
  },

  /**
   * Тихое обновление: то же, что hydrate, но без переключения `status`.
   *
   * Нужно, потому что `hydrate` ставит `loading`, а AppShell на этом статусе
   * подменяет весь экран заглушкой «Загружаем карму…». Для возврата
   * в приложение и кнопки «Обновить» это означало бы мигание всего интерфейса
   * ради данных, которые чаще всего не изменились.
   *
   * Сбой сети тоже проглатывается: показать прежние данные честнее, чем
   * заменить рабочий экран ошибкой из-за фонового запроса.
   */
  async refresh() {
    if (get().status !== 'ready') return;
    try {
      const [me, history] = await Promise.all([api.me(), api.deeds({ limit: 50 })]);
      set({
        profile: me.profile,
        inviteLink: me.inviteLink,
        counts: me.counts,
        referrals: me.referrals,
        deeds: history.deeds,
        // Дело могли подтвердить, пока приложение было свёрнуто, — праздновать
        // есть что. Уже показанное не затираем, если нового не случилось.
        celebration: pickCelebration(me.profile) ?? get().celebration,
      });
    } catch (error) {
      console.warn('[store] refresh failed', error);
    }
  },

  async addDeed(input) {
    const result = await api.createDeed(input);

    set((prev) => ({
      profile: result.profile,
      deeds: [result.deed, ...prev.deeds],
      counts: { ...prev.counts, pending: prev.counts.pending + 1 },
    }));

    // Бейджи за количество дел выдаются сразу, поэтому отметку о показанном
    // двигаем здесь же — иначе Home отпразднует их второй раз.
    forgetBadges(result.profile);

    return { deed: result.deed, newBadges: result.newBadges };
  },

  async requestReviewLinks(deedId) {
    const result = await api.sendReview(deedId);
    set((prev) => ({
      deeds: prev.deeds.map((deed) => (deed.id === deedId ? result.deed : deed)),
    }));
    return result.links;
  },

  async loadLeaderboards() {
    const [friends, global] = await Promise.all([
      api.friendsLeaderboard(),
      api.globalLeaderboard(),
    ]);
    set({
      friends: friends.entries,
      global: global.entries,
      globalMeRank: global.me?.rank ?? null,
    });
  },

  dismissCelebration() {
    set({ celebration: null });
  },
}));

function forgetBadges(profile: Profile) {
  try {
    window.localStorage.setItem(
      SEEN_BADGES_KEY,
      JSON.stringify(profile.badges.map((b) => b.code)),
    );
  } catch {
    /* приватный режим */
  }
}

/** Переход по ссылке-приглашению: `?startapp=f<id>` в initData. */
async function adoptFriendFromDeepLink(): Promise<void> {
  let ref: string | undefined;
  try {
    ref = initDataStartParam();
  } catch {
    return;
  }
  if (!ref || !/^f\d+$/.test(ref)) return;

  try {
    await api.addFriend(ref);
  } catch (error) {
    // Себя в друзья, несуществующий id, повторный переход — не повод шуметь.
    console.warn('[store] addFriend skipped', error);
  }
}

