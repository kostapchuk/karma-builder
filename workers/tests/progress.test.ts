/**
 * Пересчёт прогресса и разбор deep-link'ов. Всё чистое — без D1 и без сети.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEED_CATEGORIES } from '../../lib/karma/scoring.ts';
import { aggregateScore, applyApproval, applyDeedCreation } from '../src/data/progress.ts';
import {
  REFERRAL_JOIN_BONUS,
  REFERRAL_SHARE_PERCENT,
  referralPayout,
} from '../../lib/karma/referral.ts';
import { inviteRef, parseRef } from '../src/routes/friends.ts';
import type { UserRow } from '../src/data/users.ts';

function user(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 1,
    telegram_id: 777,
    username: null,
    first_name: 'Аня',
    photo_url: null,
    karma_total: 0,
    level: 1,
    streak_current: 0,
    streak_longest: 0,
    last_deed_date: null,
    deed_count: 0,
    category_counts: JSON.stringify(DEED_CATEGORIES.map(() => 0)),
    badges: '[]',
    referred_by: null,
    referral_bonus_paid_at: null,
    karma_referral: 0,
    referral_fraction: 0,
    created_at: '2026-08-01 10:00:00',
    last_active_at: null,
    ...overrides,
  };
}

test('первое дело: счётчик, категория, стрик и бейдж «Первый шаг»', () => {
  const update = applyDeedCreation(user(), 'volunteering', '2026-08-17', 1_760_000_000);

  assert.equal(update.deedCount, 1);
  assert.equal(update.categoryCounts[DEED_CATEGORIES.indexOf('volunteering')], 1);
  assert.equal(update.streak.currentStreak, 1);
  assert.deepEqual(
    update.newBadges.map((b) => b.code),
    ['first_deed'],
  );
});

test('второе дело в тот же день стрик не двигает и бейдж не повторяет', () => {
  const after = user({
    deed_count: 1,
    streak_current: 1,
    streak_longest: 1,
    last_deed_date: '2026-08-17',
    badges: JSON.stringify([['first_deed', 1]]),
  });
  const update = applyDeedCreation(after, 'other', '2026-08-17', 1_760_000_000);

  assert.equal(update.deedCount, 2);
  assert.equal(update.streak.currentStreak, 1);
  assert.deepEqual(update.newBadges, []);
});

test('создание дела карму не трогает — она приходит только с аппрувом', () => {
  const update = applyDeedCreation(user(), 'donation', '2026-08-17', 1);
  assert.equal('karmaTotal' in update, false);
});

test('аппрув: карма растёт на итоговый балл, уровень пересчитывается', () => {
  // 50 XP — ровно порог второго уровня по кривой 25·(N−1)·N.
  const update = applyApproval(user({ karma_total: 30 }), 20, 1_760_000_000);

  assert.equal(update.karmaTotal, 50);
  assert.equal(update.previousLevel, 1);
  assert.equal(update.level, 2);
});

test('аппрув до 5-го уровня выдаёт бейдж уровня один раз', () => {
  const first = applyApproval(user({ karma_total: 490 }), 20, 1);
  assert.equal(first.level, 5);
  assert.deepEqual(
    first.newBadges.map((b) => b.code),
    ['level_5'],
  );

  const second = applyApproval(
    user({ karma_total: 510, badges: JSON.stringify(first.badges.map((b) => [b.code, b.earnedAt])) }),
    20,
    2,
  );
  assert.deepEqual(second.newBadges, []);
});

test('итог — среднее двух оценок, половина округляется вверх', () => {
  assert.equal(aggregateScore([20, 30]), 25);
  assert.equal(aggregateScore([20, 31]), 26);
  assert.equal(aggregateScore([0, 0]), 0);
  assert.equal(aggregateScore([50, 50]), 50);
});

test('deep-link друга разбирается и отвергает мусор', () => {
  assert.equal(parseRef(inviteRef(42)), 42);
  assert.equal(parseRef('f1'), 1);
  assert.equal(parseRef('f0'), null);
  assert.equal(parseRef('friend'), null);
  assert.equal(parseRef('f-1'), null);
  assert.equal(parseRef(42), null);
  assert.equal(parseRef(undefined), null);
});

test('доля от дела приглашённого копится в сотых и не теряется', () => {
  // 1% от дела в 25 карм — это 0.25 балла. При обычном округлении получился бы
  // ноль на каждом начислении, и доля не пришла бы никогда.
  const first = referralPayout(0, 25, false);
  assert.equal(first.karma, 0);
  assert.equal(first.fraction, 25);

  const second = referralPayout(first.fraction, 25, false);
  assert.equal(second.karma, 0);
  assert.equal(second.fraction, 50);

  const third = referralPayout(second.fraction, 25, false);
  assert.equal(third.karma, 0);
  assert.equal(third.fraction, 75);

  // Четвёртое дело добирает целый балл, остаток обнуляется.
  const fourth = referralPayout(third.fraction, 25, false);
  assert.equal(fourth.karma, 1);
  assert.equal(fourth.fraction, 0);
});

test('остаток переносится, а не сгорает на границе балла', () => {
  const payout = referralPayout(90, 50, false);
  assert.equal(payout.karma, 1);
  assert.equal(payout.fraction, 40, '90 + 50 = 140 сотых → 1 балл и 40 в копилке');
});

test('разовый бонус прибавляется к доле, а не заменяет её', () => {
  const payout = referralPayout(99, 50, true);
  // 99 + 50 = 149 сотых → 1 балл, плюс разовый бонус сверху.
  assert.equal(payout.karma, 1 + REFERRAL_JOIN_BONUS);
  assert.equal(payout.fraction, 49);
});

test('доля считается от размера дела, а не поштучно', () => {
  const small = referralPayout(0, 5, false);
  const big = referralPayout(0, 50, false);
  assert.equal(small.fraction, 5 * REFERRAL_SHARE_PERCENT);
  assert.equal(big.fraction, 50 * REFERRAL_SHARE_PERCENT);
  assert.ok(big.fraction > small.fraction, 'крупное дело приносит больше мелкого');
});
