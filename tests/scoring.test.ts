import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CATEGORY_WEIGHTS,
  DEED_CATEGORIES,
  MAX_DEED_POINTS,
  MIN_DEED_POINTS,
  computeKarmaPoints,
  karmaStateFromTotal,
  levelForXp,
  levelProgress,
  levelTitle,
  minXpForLevel,
} from '../lib/karma/scoring.ts';

test('баллы = вес категории × множитель усилия', () => {
  assert.equal(computeKarmaPoints('volunteering', 3), 45);
  assert.equal(computeKarmaPoints('kindness_gesture', 1), 5);
  assert.equal(computeKarmaPoints('helping_person', 2), 20);
});

test('любая комбинация укладывается в 5..45', () => {
  for (const category of DEED_CATEGORIES) {
    for (const effort of [1, 2, 3] as const) {
      const points = computeKarmaPoints(category, effort);
      assert.ok(points >= MIN_DEED_POINTS && points <= MAX_DEED_POINTS, `${category}/${effort}`);
    }
  }
});

test('веса заданы для всех категорий', () => {
  for (const category of DEED_CATEGORIES) {
    assert.equal(typeof CATEGORY_WEIGHTS[category], 'number');
  }
});

test('пороги уровней совпадают с таблицей из плана', () => {
  const expected = [0, 50, 150, 300, 500, 750, 1050, 1400, 1800, 2250];
  expected.forEach((xp, i) => assert.equal(minXpForLevel(i + 1), xp));
});

test('levelForXp обратна minXpForLevel на границах', () => {
  for (let level = 1; level <= 60; level += 1) {
    const floor = minXpForLevel(level);
    assert.equal(levelForXp(floor), level, `порог ${level}`);
    if (level > 1) assert.equal(levelForXp(floor - 1), level - 1, `порог ${level} − 1`);
  }
});

test('уровень монотонно растёт и не скачет', () => {
  let previous = 1;
  for (let xp = 0; xp <= 5000; xp += 1) {
    const level = levelForXp(xp);
    assert.ok(level >= previous && level - previous <= 1, `xp=${xp}`);
    previous = level;
  }
});

test('karmaStateFromTotal раскладывает XP внутри уровня', () => {
  const state = karmaStateFromTotal(200, 0);
  assert.equal(state.level, 3);
  assert.equal(state.currentLevelXp, 50); // 200 − 150
  assert.equal(state.xpToNextLevel, 100); // 300 − 200
});

test('прогресс внутри уровня в пределах 0..1', () => {
  assert.equal(levelProgress(150), 0);
  assert.equal(levelProgress(225), 0.5);
  assert.ok(levelProgress(299) < 1);
});

test('титулы есть у первых десяти уровней и продолжаются выше', () => {
  assert.equal(levelTitle(1), 'Искра');
  assert.equal(levelTitle(10), 'Просветлённый');
  assert.equal(levelTitle(14), 'Просветлённый ур. 14');
});
