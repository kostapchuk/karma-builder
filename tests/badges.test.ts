import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BADGES, evaluateNewBadges } from '../lib/karma/badges.ts';
import { DEED_CATEGORIES } from '../lib/karma/scoring.ts';
import type { Badge } from '../lib/karma/types.ts';

const NOW = 1_755_400_000;
const noStreak = { currentStreak: 0, longestStreak: 0, lastDeedDate: '' };
const noCategories = DEED_CATEGORIES.map(() => 0);

test('первое дело выдаёт first_deed', () => {
  const badges = evaluateNewBadges(
    [],
    { deedCount: 1, level: 1, streak: noStreak, categoryCounts: noCategories },
    NOW,
  );
  assert.deepEqual(
    badges.map((b) => b.code),
    ['first_deed'],
  );
  assert.equal(badges[0].earnedAt, NOW);
});

test('уже выданный бейдж повторно не выдаётся', () => {
  const earned: Badge[] = [{ code: 'first_deed', earnedAt: NOW - 100 }];
  const badges = evaluateNewBadges(
    earned,
    { deedCount: 5, level: 1, streak: noStreak, categoryCounts: noCategories },
    NOW,
  );
  assert.deepEqual(badges, []);
});

test('порог 10 дел выдаёт разом и first_deed, и deeds_10', () => {
  const badges = evaluateNewBadges(
    [],
    { deedCount: 10, level: 1, streak: noStreak, categoryCounts: noCategories },
    NOW,
  );
  assert.deepEqual(
    badges.map((b) => b.code).sort(),
    ['deeds_10', 'first_deed'],
  );
});

test('стрик-бейджи смотрят на рекорд, а не на текущий стрик', () => {
  const badges = evaluateNewBadges(
    [],
    {
      deedCount: 30,
      level: 1,
      // текущий стрик сброшен, но рекорд в 7 дней уже был
      streak: { currentStreak: 1, longestStreak: 7, lastDeedDate: '2026-08-17' },
      categoryCounts: noCategories,
    },
    NOW,
  );
  assert.ok(badges.some((b) => b.code === 'streak_7'));
  assert.ok(!badges.some((b) => b.code === 'streak_30'));
});

test('category_collector требует все категории без исключения', () => {
  const almost = DEED_CATEGORIES.map((_, i) => (i === 0 ? 0 : 3));
  const all = DEED_CATEGORIES.map(() => 1);
  const ctx = { deedCount: 20, level: 1, streak: noStreak };

  assert.ok(
    !evaluateNewBadges([], { ...ctx, categoryCounts: almost }, NOW).some(
      (b) => b.code === 'category_collector',
    ),
  );
  assert.ok(
    evaluateNewBadges([], { ...ctx, categoryCounts: all }, NOW).some(
      (b) => b.code === 'category_collector',
    ),
  );
});

test('у каждого бейджа в каталоге уникальный код и есть условие', () => {
  const codes = BADGES.map((b) => b.code);
  assert.equal(new Set(codes).size, codes.length);

  const maxed = evaluateNewBadges(
    [],
    {
      deedCount: 1000,
      level: 99,
      streak: { currentStreak: 100, longestStreak: 100, lastDeedDate: '2026-08-17' },
      categoryCounts: DEED_CATEGORIES.map(() => 10),
    },
    NOW,
  );
  assert.equal(maxed.length, BADGES.length, 'все бейджи должны быть достижимы');
});
