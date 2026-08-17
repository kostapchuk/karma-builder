/**
 * Валидация initData — единственная дверь в приватные маршруты.
 * Проверяем, что она открывается только своим ключом.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_AUTH_AGE_SECONDS, validateInitData } from '../src/auth/telegramAuth.ts';
import { signInitData } from './helpers/initData.ts';

const TOKEN = '123456:test-bot-token';
const USER = { id: 777, username: 'kind', first_name: 'Аня', photo_url: 'https://t.me/i.jpg' };

async function expectRejection(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e) => e,
  );
  assert.ok(error, `ожидался отказ с кодом ${code}`);
  assert.equal((error as { code: string }).code, code);
  assert.equal((error as { status: number }).status, 401);
}

test('валидный initData распознаётся, поля юзера доезжают', async () => {
  const raw = signInitData(TOKEN, USER, { startParam: 'f42' });
  const result = await validateInitData(raw, TOKEN);

  assert.equal(result.user.id, 777);
  assert.equal(result.user.username, 'kind');
  assert.equal(result.user.firstName, 'Аня');
  assert.equal(result.user.photoUrl, 'https://t.me/i.jpg');
  assert.equal(result.startParam, 'f42');
});

test('подделанный hash отклоняется', async () => {
  const raw = signInitData(TOKEN, USER);
  const tampered = raw.replace(/hash=[0-9a-f]+/, `hash=${'0'.repeat(64)}`);
  await expectRejection(validateInitData(tampered, TOKEN), 'init_data_bad_hash');
});

test('подмена данных под чужой подписью отклоняется', async () => {
  // Подпись настоящая, но выдана другому user.id — классическая попытка
  // приписать себе чужие дела.
  const raw = signInitData(TOKEN, USER);
  const params = new URLSearchParams(raw);
  params.set('user', JSON.stringify({ ...USER, id: 999 }));
  await expectRejection(validateInitData(params.toString(), TOKEN), 'init_data_bad_hash');
});

test('строка, подписанная чужим ботом, отклоняется', async () => {
  const raw = signInitData('999:other-bot', USER);
  await expectRejection(validateInitData(raw, TOKEN), 'init_data_bad_hash');
});

test('протухший auth_date отклоняется', async () => {
  const authDate = Math.floor(Date.now() / 1000) - MAX_AUTH_AGE_SECONDS - 60;
  const raw = signInitData(TOKEN, USER, { authDate });
  await expectRejection(validateInitData(raw, TOKEN), 'init_data_expired');
});

test('свежий auth_date у самой границы принимается', async () => {
  const now = Math.floor(Date.now() / 1000);
  const raw = signInitData(TOKEN, USER, { authDate: now - MAX_AUTH_AGE_SECONDS + 60 });
  const result = await validateInitData(raw, TOKEN, now);
  assert.equal(result.user.id, 777);
});

test('пустая строка и отсутствие hash отклоняются', async () => {
  await expectRejection(validateInitData('', TOKEN), 'init_data_missing');
  await expectRejection(validateInitData('user=%7B%7D&auth_date=1', TOKEN), 'init_data_no_hash');
});

test('поле signature не ломает проверку', async () => {
  // Часть клиентов присылает Ed25519-подпись рядом с hash. Она подписана
  // вместе со всеми полями, и обе раскладки data_check_string должны сойтись.
  const raw = signInitData(TOKEN, USER, { extra: { signature: 'abcDEF123' } });
  const result = await validateInitData(raw, TOKEN);
  assert.equal(result.user.id, 777);
});
