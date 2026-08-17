/**
 * Одноразовый импорт истории V1 из CloudStorage.
 *
 * Ключевое решение плана: импортированные дела НЕ дают подтверждённой кармы.
 * Они ложатся со `status='legacy_unverified'`, а их сумма идёт в
 * `karma_self_total` — отдельную шкалу, которая видна в профиле, но не влияет
 * на лидерборды. Иначе накрученные локальные баллы отмывались бы в рейтинг.
 *
 * Идемпотентность двойная:
 *   - `users.legacy_imported_at` — серверный флаг, второй вызов уходит вхолостую;
 *   - id дела детерминирован (`l<userId>-<v1id>`) + INSERT OR IGNORE, поэтому
 *     даже параллельные вызовы с двух устройств не задвоят историю.
 */

import { DEED_CATEGORIES, levelForXp } from '../../../lib/karma/scoring';
import { evaluateNewBadges } from '../../../lib/karma/badges';
import { EMPTY_STREAK, applyDeedToStreak, daysBetween } from '../../../lib/karma/streak';
import type { Streak } from '../../../lib/karma/types';
import { isDeedCategory, isEffortLevel } from '../data/deeds';
import { badges, categoryCounts, encodeBadges, publicProfile, streak, type UserRow } from '../data/users';
import type { Env } from '../env';
import { badRequest, json, readJson } from '../http';
import { legacyDeedId } from '../lib/ids';
import { isDateKey, sqlNow, utcDateKey } from '../lib/time';

/** Потолок на запрос: раскладка V1 упирается в ~20k дел, но столько никто не набьёт. */
const MAX_IMPORT_DEEDS = 5000;
/** Сколько INSERT'ов кладём в один батч. */
const INSERT_BATCH = 50;

interface LegacyDeed {
  id: string;
  description: string;
  category: string;
  effortLevel: number;
  karmaPoints: number;
  createdAt: number;
  localDate: string;
}

function normalize(raw: unknown): LegacyDeed | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;

  if (typeof d.id !== 'string' || d.id.length === 0 || d.id.length > 32) return null;
  if (!isDeedCategory(d.category) || !isEffortLevel(d.effortLevel)) return null;

  const createdAt = Number(d.createdAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return null;

  // karmaPoints берём как есть: пересчёт по текущим весам исказил бы историю —
  // пользователь тогда видел другое число.
  const karmaPoints = Number(d.karmaPoints);
  if (!Number.isFinite(karmaPoints) || karmaPoints < 0 || karmaPoints > 1000) return null;

  return {
    id: d.id,
    description: typeof d.description === 'string' ? d.description.slice(0, 140) : '',
    category: d.category,
    effortLevel: d.effortLevel,
    karmaPoints: Math.round(karmaPoints),
    createdAt: Math.floor(createdAt),
    localDate: isDateKey(d.localDate) ? d.localDate : utcDateKey(new Date(createdAt * 1000)),
  };
}

/** Стрик по календарным дням: сворачиваем уникальные даты по возрастанию. */
export function streakFromDates(dates: string[]): Streak {
  const unique = [...new Set(dates)].sort();
  return unique.reduce<Streak>((acc, date) => applyDeedToStreak(acc, date), { ...EMPTY_STREAK });
}

/** Импорт может приехать после первых дел в V2 — берём более свежую серию. */
export function mergeStreaks(current: Streak, imported: Streak): Streak {
  const longest = Math.max(current.longestStreak, imported.longestStreak);
  if (!current.lastDeedDate) return { ...imported, longestStreak: longest };
  if (!imported.lastDeedDate) return { ...current, longestStreak: longest };
  const fresher = daysBetween(imported.lastDeedDate, current.lastDeedDate) >= 0 ? current : imported;
  return { ...fresher, longestStreak: longest };
}

export async function importLegacy(request: Request, env: Env, user: UserRow): Promise<Response> {
  if (user.legacy_imported_at) {
    return json({ imported: 0, alreadyImported: true, profile: publicProfile(user) });
  }

  const body = await readJson<{ deeds?: unknown }>(request);
  if (!Array.isArray(body.deeds)) throw badRequest('invalid_deeds');
  if (body.deeds.length > MAX_IMPORT_DEEDS) throw badRequest('too_many_deeds');

  const deeds = body.deeds.map(normalize).filter((d): d is LegacyDeed => d !== null);
  const now = sqlNow();
  const nowEpoch = Math.floor(Date.now() / 1000);

  for (let i = 0; i < deeds.length; i += INSERT_BATCH) {
    await env.DB.batch(
      deeds.slice(i, i + INSERT_BATCH).map((deed) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO deeds
             (id, user_id, description, category, effort_level, base_score, final_score, status, local_date, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 'legacy_unverified', ?7, ?8)`,
        ).bind(
          legacyDeedId(user.id, deed.id),
          user.id,
          deed.description,
          deed.category,
          deed.effortLevel,
          deed.karmaPoints,
          deed.localDate,
          new Date(deed.createdAt * 1000).toISOString().slice(0, 19).replace('T', ' '),
        ),
      ),
    );
  }

  const karmaSelf = deeds.reduce((sum, d) => sum + d.karmaPoints, 0);
  const counts = categoryCounts(user);
  for (const deed of deeds) {
    const index = DEED_CATEGORIES.indexOf(deed.category as never);
    if (index >= 0) counts[index] += 1;
  }

  const nextStreak = mergeStreaks(streak(user), streakFromDates(deeds.map((d) => d.localDate)));
  const deedCount = user.deed_count + deeds.length;
  const karmaSelfTotal = user.karma_self_total + karmaSelf;

  // Бейджи считаем по СУММЕ обеих шкал: достижения V1 личные, они не про
  // рейтинг, и терять их при переезде незачем.
  const newBadges = evaluateNewBadges(
    badges(user),
    {
      deedCount,
      level: levelForXp(user.karma_total + karmaSelfTotal),
      streak: nextStreak,
      categoryCounts: counts,
    },
    nowEpoch,
  );
  const allBadges = [...badges(user), ...newBadges];

  await env.DB.prepare(
    `UPDATE users SET karma_self_total = ?1, deed_count = ?2, category_counts = ?3,
       streak_current = ?4, streak_longest = ?5, last_deed_date = ?6, badges = ?7,
       legacy_imported_at = ?8, last_active_at = ?8
     WHERE id = ?9`,
  )
    .bind(
      karmaSelfTotal,
      deedCount,
      JSON.stringify(counts),
      nextStreak.currentStreak,
      nextStreak.longestStreak,
      nextStreak.lastDeedDate,
      encodeBadges(allBadges),
      now,
      user.id,
    )
    .run();

  const nextUser: UserRow = {
    ...user,
    karma_self_total: karmaSelfTotal,
    deed_count: deedCount,
    category_counts: JSON.stringify(counts),
    streak_current: nextStreak.currentStreak,
    streak_longest: nextStreak.longestStreak,
    last_deed_date: nextStreak.lastDeedDate,
    badges: encodeBadges(allBadges),
    legacy_imported_at: now,
  };

  return json({
    imported: deeds.length,
    skipped: body.deeds.length - deeds.length,
    karmaSelfTotal,
    newBadges,
    profile: publicProfile(nextUser),
    alreadyImported: false,
  });
}
