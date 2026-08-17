import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EMPTY_STREAK,
  applyDeedToStreak,
  currentStreakOn,
  daysBetween,
  toDateKey,
} from '../lib/karma/streak.ts';

test('daysBetween считает календарные дни, включая переход через месяц', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-02'), 1);
  assert.equal(daysBetween('2026-01-31', '2026-02-01'), 1);
  assert.equal(daysBetween('2026-02-28', '2026-03-01'), 1); // 2026 — не високосный
  assert.equal(daysBetween('2026-01-05', '2026-01-01'), -4);
});

test('первое дело поднимает стрик до 1', () => {
  const streak = applyDeedToStreak(EMPTY_STREAK, '2026-08-17');
  assert.deepEqual(streak, {
    currentStreak: 1,
    longestStreak: 1,
    lastDeedDate: '2026-08-17',
  });
});

test('несколько дел в один день не считаются повторно', () => {
  let streak = applyDeedToStreak(EMPTY_STREAK, '2026-08-17');
  streak = applyDeedToStreak(streak, '2026-08-17');
  streak = applyDeedToStreak(streak, '2026-08-17');
  assert.equal(streak.currentStreak, 1);
});

test('следующий день даёт +1', () => {
  let streak = applyDeedToStreak(EMPTY_STREAK, '2026-08-17');
  streak = applyDeedToStreak(streak, '2026-08-18');
  assert.equal(streak.currentStreak, 2);
  assert.equal(streak.longestStreak, 2);
});

test('пропуск дня сбрасывает текущий стрик, но сохраняет рекорд', () => {
  let streak = EMPTY_STREAK;
  for (const day of ['2026-08-10', '2026-08-11', '2026-08-12']) {
    streak = applyDeedToStreak(streak, day);
  }
  assert.equal(streak.currentStreak, 3);

  streak = applyDeedToStreak(streak, '2026-08-15'); // пропуск в 3 дня
  assert.equal(streak.currentStreak, 1);
  assert.equal(streak.longestStreak, 3);
});

test('стрик протухает, если последнее дело было раньше вчера', () => {
  const streak = { currentStreak: 5, longestStreak: 9, lastDeedDate: '2026-08-15' };
  assert.equal(currentStreakOn(streak, '2026-08-15'), 5);
  assert.equal(currentStreakOn(streak, '2026-08-16'), 5); // вчера — ещё жив
  assert.equal(currentStreakOn(streak, '2026-08-17'), 0); // позавчера — уже нет
});

test('toDateKey использует локальную дату, а не UTC', () => {
  const date = new Date(2026, 7, 5, 23, 30);
  assert.equal(toDateKey(date), '2026-08-05');
});
