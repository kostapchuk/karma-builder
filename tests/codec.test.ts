import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeKarmaPoints } from '../lib/karma/scoring.ts';
import type { Deed } from '../lib/karma/types.ts';
import {
  CHUNK_MAX_DEEDS,
  VALUE_MAX_LENGTH,
  chunkFits,
  decodeChunk,
  decodeState,
  emptyState,
  encodeChunk,
  encodeState,
} from '../lib/storage/codec.ts';

function makeDeed(i: number, description = 'Помог соседке донести сумки до квартиры'): Deed {
  return {
    id: `id${i}`.padEnd(8, 'x'),
    description,
    category: 'helping_person',
    effortLevel: 2,
    karmaPoints: computeKarmaPoints('helping_person', 2),
    createdAt: 1_755_400_000 + i * 3600,
  };
}

test('дело переживает round-trip без потерь', () => {
  const deed = makeDeed(1);
  const [restored] = decodeChunk(encodeChunk([deed]));
  assert.deepEqual(restored, deed);
});

test('повреждённый чанк не роняет чтение', () => {
  assert.deepEqual(decodeChunk('{не json'), []);
  assert.deepEqual(decodeChunk(''), []);
  assert.deepEqual(decodeChunk(undefined), []);
});

test('дела с неизвестной категорией отбрасываются, остальные читаются', () => {
  const good = encodeChunk([makeDeed(1)]);
  const mixed = `[["zzz",1,99,1,10,"из будущей версии"],${good.slice(1)}`;
  const decoded = decodeChunk(mixed);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].category, 'helping_person');
});

test('чанк, набитый по правилу chunkFits, всегда влезает в один ключ', () => {
  // Худший случай: у каждого дела описание максимальной длины. По количеству
  // такой чанк до 25 дел не доживёт — его закроет ограничение по длине.
  for (const description of ['ж'.repeat(140), 'ok', '']) {
    const deeds: Deed[] = [];
    let encoded = encodeChunk(deeds);

    for (let i = 0; i < 100; i += 1) {
      const candidate = [...deeds, makeDeed(i, description)];
      const candidateEncoded = encodeChunk(candidate);
      if (!chunkFits(candidateEncoded, candidate.length)) break;
      deeds.push(candidate[candidate.length - 1]);
      encoded = candidateEncoded;
    }

    assert.ok(deeds.length > 0, 'хотя бы одно дело должно помещаться');
    assert.ok(deeds.length <= CHUNK_MAX_DEEDS);
    assert.ok(
      encoded.length <= VALUE_MAX_LENGTH,
      `чанк из ${deeds.length} дел занял ${encoded.length} символов`,
    );
    assert.equal(decodeChunk(encoded).length, deeds.length);
  }
});

test('chunkFits закрывает чанк по количеству и по длине', () => {
  const short = encodeChunk([makeDeed(1)]);
  assert.ok(chunkFits(short, 1));
  assert.ok(!chunkFits(short, CHUNK_MAX_DEEDS + 1));
  assert.ok(!chunkFits('x'.repeat(VALUE_MAX_LENGTH), 1));
});

test('обычное дело укладывается примерно в 200 байт', () => {
  const encoded = encodeChunk([makeDeed(1)]);
  assert.ok(encoded.length < 220, `дело заняло ${encoded.length} символов`);
});

test('state переживает round-trip', () => {
  const state = {
    ...emptyState(),
    totalKarma: 1234,
    updatedAt: 1_755_400_000,
    streak: { currentStreak: 4, longestStreak: 11, lastDeedDate: '2026-08-17' },
    badges: [
      { code: 'first_deed', earnedAt: 1_755_000_000 },
      { code: 'streak_7', earnedAt: 1_755_100_000 },
    ],
    categoryCounts: [3, 1, 0, 5, 2, 0, 1, 0],
    deedCount: 12,
    lastChunk: 2,
  };
  assert.deepEqual(decodeState(encodeState(state)), state);
});

test('state со всеми бейджами остаётся сильно меньше лимита', () => {
  const state = {
    ...emptyState(),
    totalKarma: 99_999,
    badges: Array.from({ length: 10 }, (_, i) => ({
      code: `badge_number_${i}`,
      earnedAt: 1_755_400_000,
    })),
    categoryCounts: [999, 999, 999, 999, 999, 999, 999, 999],
    deedCount: 7992,
    lastChunk: 400,
  };
  assert.ok(encodeState(state).length < VALUE_MAX_LENGTH / 2);
});

test('битый state читается как пустой, а не бросает', () => {
  assert.deepEqual(decodeState('не json'), emptyState());
  assert.deepEqual(decodeState(null), emptyState());
});
