/**
 * Пересчёт прогресса и разбор deep-link'ов. Всё чистое — без D1 и без сети.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEED_CATEGORIES } from '../../lib/karma/scoring.ts';
import { aggregateScore, applyApproval, applyDeedCreation } from '../src/data/progress.ts';
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
