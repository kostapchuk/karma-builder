/**
 * Токен ревью — единственная защита дела от постороннего: он и есть пароль.
 * Поэтому проверяем не «работает вообще», а форму и энтропию.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ALPHABET, randomId, reviewToken } from '../src/lib/ids.ts';

test('алфавит ровно 64 символа', () => {
  // Маска `byte & 63` даёт индексы 0..63. Символом меньше — и часть байт
  // молча превращалась бы в undefined прямо посреди токена.
  assert.equal(ALPHABET.length, 64);
  assert.equal(new Set(ALPHABET).size, 64, 'символы не повторяются');
  assert.ok(/^[A-Za-z0-9_-]+$/.test(ALPHABET), 'алфавит безопасен для URL');
});

test('токен ревью — 32 символа только из алфавита', () => {
  for (let i = 0; i < 200; i += 1) {
    const token = reviewToken();
    assert.equal(token.length, 32);
    assert.ok(/^[A-Za-z0-9_-]{32}$/.test(token), `подозрительный токен: ${token}`);
    assert.ok(!token.includes('undefined'));
  }
});

test('токены не повторяются', () => {
  const seen = new Set(Array.from({ length: 1000 }, () => reviewToken()));
  assert.equal(seen.size, 1000);
});

test('randomId уважает запрошенную длину', () => {
  assert.equal(randomId(1).length, 1);
  assert.equal(randomId(64).length, 64);
});
