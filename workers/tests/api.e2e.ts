/**
 * End-to-end проверка API на живом wrangler dev + локальной D1.
 *
 * Здесь проверяется то, что юнит-тестами не проверяется в принципе: поведение
 * SQL-условий под гонкой, транзакционность батчей и то, что карма начисляется
 * ровно один раз. Запуск: `npm run test:e2e` (поднимает Worker сам).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';

import { REVIEWER_SLOTS } from '../../lib/karma/review.ts';
import { signInitData } from './helpers/initData.ts';
import {
  BOT_TOKEN,
  api,
  resetDatabase,
  sql,
  sqlRows,
  startWorker,
  stopWorker,
} from './helpers/server.ts';

const ANNA = signInitData(BOT_TOKEN, { id: 1001, first_name: 'Аня', username: 'anna' });
const BORIS = signInitData(BOT_TOKEN, { id: 1002, first_name: 'Борис', username: 'boris' });
const VERA = signInitData(BOT_TOKEN, { id: 1003, first_name: 'Вера', username: 'vera' });

before(async () => {
  await startWorker();
}, { timeout: 90_000 });

after(async () => {
  await stopWorker();
});

/** Дело + две ссылки на ревью. Возвращает то, что дальше нужно тестам. */
async function deedWithLinks(initData: string, overrides: Record<string, unknown> = {}) {
  const created = await api<{ deed: { id: string; baseScore: number } }>('POST', '/api/deeds', {
    initData,
    body: { description: 'Помог соседке с покупками', category: 'helping_person', effortLevel: 2, ...overrides },
  });
  assert.equal(created.status, 200);

  const sent = await api<{ links: { slot: number; url: string }[] }>(
    'POST',
    `/api/deeds/${created.body.deed.id}/send-review`,
    { initData },
  );
  assert.equal(sent.status, 200);

  // Ссылка — deep-link в Mini App: t.me/<bot>?startapp=r<token>.
  const tokens = sent.body.links.map((link) => link.url.split('startapp=r')[1]);
  return { id: created.body.deed.id, baseScore: created.body.deed.baseScore, tokens, links: sent.body.links };
}

/** Рецензенты по числу слотов. Автор в этот список не попадает никогда. */
const reviewersFor = (author: string) =>
  [BORIS, VERA, ANNA].filter((who) => who !== author).slice(0, REVIEWER_SLOTS.length);

const karmaOf = (telegramId: number) =>
  sqlRows<{ karma_total: number; karma_self_total: number }>(
    `SELECT karma_total, karma_self_total FROM users WHERE telegram_id = ${telegramId}`,
  )[0];

test('приватный маршрут без initData и с подделанной подписью отвечает 401', async () => {
  assert.equal((await api('GET', '/api/me')).status, 401);

  const forged = ANNA.replace(/hash=[0-9a-f]+/, `hash=${'0'.repeat(64)}`);
  const response = await api<{ error: string }>('GET', '/api/me', { initData: forged });
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'init_data_bad_hash');

  const stale = signInitData(BOT_TOKEN, { id: 1001 }, { authDate: Math.floor(Date.now() / 1000) - 90_000 });
  assert.equal((await api('GET', '/api/me', { initData: stale })).status, 401);
});

test('первый валидный запрос заводит юзера', async () => {
  const response = await api<{ profile: { telegramId: number; karmaTotal: number; level: number } }>(
    'GET',
    '/api/me',
    { initData: ANNA },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.profile.telegramId, 1001);
  assert.equal(response.body.profile.karmaTotal, 0);
  assert.equal(response.body.profile.level, 1);
});

test('дело создаётся со статусом pending и base_score по эвристике V1', async () => {
  const created = await api<{
    deed: { id: string; baseScore: number; status: string; slots: { state: string }[] };
    profile: { karmaTotal: number; deedCount: number; streak: number };
    newBadges: { code: string }[];
  }>('POST', '/api/deeds', {
    initData: ANNA,
    body: {
      description: 'Волонтёрил на приюте',
      category: 'volunteering',
      effortLevel: 3,
      localDate: '2026-08-17',
    },
  });

  assert.equal(created.status, 200);
  assert.equal(created.body.deed.baseScore, 45); // 15 × 3 — потолок V1-эвристики
  assert.equal(created.body.deed.status, 'pending');
  assert.deepEqual(
    created.body.deed.slots.map((s) => s.state),
    REVIEWER_SLOTS.map(() => 'none'),
  );

  // Карма за запись дела не начисляется: в V2 её даёт только ревью.
  assert.equal(created.body.profile.karmaTotal, 0);
  assert.equal(created.body.profile.deedCount, 1);
  assert.equal(created.body.profile.streak, 1);
  assert.deepEqual(created.body.newBadges.map((b) => b.code), ['first_deed']);
});

test('валидация: пустая категория, чужой уровень усилия, слишком длинное описание', async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ category: 'nope', effortLevel: 1 }, 'invalid_category'],
    [{ category: 'other', effortLevel: 7 }, 'invalid_effort_level'],
    [{ category: 'other', effortLevel: 1, description: 'x'.repeat(141) }, 'description_too_long'],
  ];

  for (const [body, error] of cases) {
    const response = await api<{ error: string }>('POST', '/api/deeds', { initData: ANNA, body });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, error);
  }
});

test('ревью посторонних: итог — среднее оценок, карма растёт ровно на него', async () => {
  const before = karmaOf(1001).karma_total;
  const deed = await deedWithLinks(ANNA);
  assert.equal(deed.tokens.length, REVIEWER_SLOTS.length);

  // Оценки берём из этого набора по числу слотов: при двух рецензентах
  // получится среднее 25, при одном — ровно 20.
  const scores = [20, 30].slice(0, REVIEWER_SLOTS.length);
  const expected = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  // Дело глазами постороннего: он опознан, но дело не его.
  const page = await api<{ deed: { baseScore: number }; anchors: unknown[]; maxScore: number }>(
    'GET',
    `/api/review/${deed.tokens[0]}`,
    { initData: BORIS },
  );
  assert.equal(page.status, 200);
  assert.equal(page.body.deed.baseScore, deed.baseScore);
  assert.equal(page.body.anchors.length, 3);
  assert.equal(page.body.maxScore, 50);

  const reviewers = reviewersFor(ANNA);

  for (const [index, score] of scores.entries()) {
    const last = index === scores.length - 1;
    const response = await api<{ status: string; finalScore: number | null }>(
      'POST',
      `/api/review/${deed.tokens[index]}`,
      {
        initData: reviewers[index],
        body: index === 0 ? { score, comment: 'Хорошее дело' } : { score },
      },
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.status, last ? 'approved' : 'recorded');
    assert.equal(response.body.finalScore, last ? expected : null);

    // Карма приходит только с последней оценкой, не раньше.
    assert.equal(karmaOf(1001).karma_total, last ? before + expected : before);

    if (!last) {
      const mid = await api<{ deed: { status: string } }>('GET', `/api/deeds/${deed.id}`, {
        initData: ANNA,
      });
      assert.equal(mid.body.deed.status, 'partially_reviewed');
    }
  }

  const detail = await api<{
    deed: { status: string; finalScore: number; slots: { state: string; score: number | null; comment: string | null }[] };
  }>('GET', `/api/deeds/${deed.id}`, { initData: ANNA });
  assert.equal(detail.body.deed.status, 'approved');
  assert.equal(detail.body.deed.finalScore, expected);
  assert.deepEqual(
    detail.body.deed.slots.map((s) => s.state),
    REVIEWER_SLOTS.map(() => 'reviewed'),
  );
  assert.equal(detail.body.deed.slots[0].score, 20);
  assert.equal(detail.body.deed.slots[0].comment, 'Хорошее дело');
});

test('ссылка одноразовая: повторный сабмит отклоняется', async () => {
  const deed = await deedWithLinks(ANNA);

  assert.equal(
    (await api('POST', `/api/review/${deed.tokens[0]}`, { initData: BORIS, body: { score: 10 } }))
      .status,
    200,
  );

  const repeat = await api<{ error: string }>('POST', `/api/review/${deed.tokens[0]}`, {
    initData: BORIS,
    body: { score: 50 },
  });
  assert.equal(repeat.status, 410);
  assert.equal(repeat.body.error, 'link_used');

  // И сама страница по использованной ссылке больше не открывается.
  assert.equal((await api('GET', `/api/review/${deed.tokens[0]}`, { initData: BORIS })).status, 410);
});

test('гонка двух сабмитов по одному токену: засчитывается ровно один', async () => {
  const deed = await deedWithLinks(ANNA);
  const token = deed.tokens[0];

  const [a, b] = await Promise.all([
    api('POST', `/api/review/${token}`, { initData: BORIS, body: { score: 10 } }),
    api('POST', `/api/review/${token}`, { initData: VERA, body: { score: 50 } }),
  ]);

  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 410]);

  const rows = sqlRows<{ n: number }>(
    `SELECT COUNT(*) AS n FROM reviews WHERE deed_id = '${deed.id}'`,
  );
  assert.equal(rows[0].n, 1);
});

test('гонка двух последних оценок: карма начисляется один раз', async () => {
  const before = karmaOf(1001).karma_total;
  const deed = await deedWithLinks(ANNA);

  // Все оценки уходят одновременно — каждый запрос может увидеть, что их
  // набралось достаточно, и попытаться начислить карму.
  const reviewers = reviewersFor(ANNA);
  await Promise.all(
    deed.tokens.map((token, index) =>
      api('POST', `/api/review/${token}`, { initData: reviewers[index], body: { score: 40 } }),
    ),
  );

  assert.equal(karmaOf(1001).karma_total, before + 40);
  const rows = sqlRows<{ status: string; final_score: number }>(
    `SELECT status, final_score FROM deeds WHERE id = '${deed.id}'`,
  );
  assert.equal(rows[0].status, 'approved');
  assert.equal(rows[0].final_score, 40);
});

test('автор не может подтвердить собственное дело', async () => {
  const before = karmaOf(1001).karma_total;
  const deed = await deedWithLinks(ANNA);

  // Ровно то, ради чего ревью переехало в Mini App: раньше страница
  // открывалась без логина, и автор проходил по своей же ссылке.
  const page = await api<{ error: string }>('GET', `/api/review/${deed.tokens[0]}`, {
    initData: ANNA,
  });
  assert.equal(page.status, 410);
  assert.equal(page.body.error, 'cannot_review_own_deed');

  const submitted = await api<{ error: string }>('POST', `/api/review/${deed.tokens[0]}`, {
    initData: ANNA,
    body: { score: 50 },
  });
  assert.equal(submitted.status, 410);
  assert.equal(submitted.body.error, 'cannot_review_own_deed');

  assert.equal(karmaOf(1001).karma_total, before);
  assert.equal(
    sqlRows<{ n: number }>(`SELECT COUNT(*) AS n FROM reviews WHERE deed_id = '${deed.id}'`)[0].n,
    0,
  );
});

test(
  'один человек не оценивает одно дело дважды',
  {
    // Ровно тот случай, с которого началась переделка: слотов было два, и один
    // человек прошёл по обеим ссылкам. При одном рецензенте воспроизвести это
    // нечем — первая же оценка подтверждает дело, и раньше срабатывает
    // «дело уже подтверждено». Проверка нужна на случай возврата к двум.
    skip: REVIEWER_SLOTS.length < 2 ? 'нужен второй слот: при одном ссылка всего одна' : false,
  },
  async () => {
    const deed = await deedWithLinks(ANNA);

    const first = await api('POST', `/api/review/${deed.tokens[0]}`, {
      initData: BORIS,
      body: { score: 10 },
    });
    assert.equal(first.status, 200);

    // Та же ссылка ему больше не откроется, но и вторая — тоже.
    const second = await api<{ error: string }>('POST', `/api/review/${deed.tokens[1]}`, {
      initData: BORIS,
      body: { score: 50 },
    });
    assert.equal(second.status, 410);
    assert.equal(second.body.error, 'already_reviewed_by_you');

    assert.equal(
      sqlRows<{ n: number }>(`SELECT COUNT(*) AS n FROM reviews WHERE deed_id = '${deed.id}'`)[0].n,
      1,
    );
    assert.equal(
      sqlRows<{ status: string }>(`SELECT status FROM deeds WHERE id = '${deed.id}'`)[0].status,
      'partially_reviewed',
    );
  },
);

test('оценка вне диапазона 0–50 не принимается', async () => {
  const deed = await deedWithLinks(ANNA);

  for (const score of [-1, 51, 12.5, '20']) {
    const response = await api<{ error: string }>('POST', `/api/review/${deed.tokens[0]}`, {
      initData: BORIS,
      body: { score },
    });
    assert.equal(response.status, 400, `score=${score}`);
    assert.equal(response.body.error, 'invalid_score');
  }
});

test('истёкшая ссылка мертва, перегенерация выдаёт рабочую', async () => {
  const deed = await deedWithLinks(ANNA);
  const dead = deed.tokens[0];

  sql(`UPDATE review_tokens SET expires_at = '2020-01-01 00:00:00' WHERE token = '${dead}'`);

  const page = await api<{ error: string }>('GET', `/api/review/${dead}`, { initData: BORIS });
  assert.equal(page.status, 410);
  assert.equal(page.body.error, 'link_expired');

  // Автор видит слот истёкшим и жмёт «перегенерировать».
  const detail = await api<{ deed: { slots: { state: string }[] } }>('GET', `/api/deeds/${deed.id}`, {
    initData: ANNA,
  });
  assert.equal(detail.body.deed.slots[0].state, 'expired');

  const regenerated = await api<{ links: { slot: number; url: string }[] }>(
    'POST',
    `/api/deeds/${deed.id}/send-review`,
    { initData: ANNA },
  );
  const fresh = regenerated.body.links.find((l) => l.slot === 1)!.url.split('startapp=r')[1];
  assert.notEqual(fresh, dead);
  assert.equal((await api('GET', `/api/review/${fresh}`, { initData: BORIS })).status, 200);

  // Старая ссылка после перегенерации перестаёт существовать совсем.
  assert.equal((await api('GET', `/api/review/${dead}`, { initData: BORIS })).status, 404);

  // Живой соседний слот переиспользуется, а не плодит новый токен.
  for (const slot of REVIEWER_SLOTS.slice(1)) {
    assert.equal(
      regenerated.body.links.find((l) => l.slot === slot)!.url.split('startapp=r')[1],
      deed.tokens[slot - 1],
    );
  }
});

test('чужое дело не открывается и ссылок на него не выдаётся', async () => {
  const deed = await deedWithLinks(ANNA);

  assert.equal((await api('GET', `/api/deeds/${deed.id}`, { initData: BORIS })).status, 404);
  assert.equal(
    (await api('POST', `/api/deeds/${deed.id}/send-review`, { initData: BORIS })).status,
    404,
  );
});

test('история фильтруется по статусу', async () => {
  const all = await api<{ deeds: { status: string }[] }>('GET', '/api/deeds?limit=100', {
    initData: ANNA,
  });
  assert.equal(all.status, 200);
  assert.ok(all.body.deeds.length > 0);

  const approved = await api<{ deeds: { status: string }[] }>(
    'GET',
    '/api/deeds?status=approved&limit=100',
    { initData: ANNA },
  );
  assert.ok(approved.body.deeds.every((d) => d.status === 'approved'));
  assert.ok(approved.body.deeds.length < all.body.deeds.length);
});

test('импорт V1 идёт в отдельную шкалу и не двигает лидерборд', async () => {
  const before = karmaOf(1001);
  const rankBefore = await api<{ me: { rank: number } }>('GET', '/api/leaderboard/global', {
    initData: ANNA,
  });

  const imported = await api<{ imported: number; karmaSelfTotal: number; alreadyImported: boolean }>(
    'POST',
    '/api/import/legacy',
    {
      initData: ANNA,
      body: {
        deeds: [
          { id: 'v1aaa', description: 'Покормил уличных котов', category: 'animal_care', effortLevel: 1, karmaPoints: 10, createdAt: 1_755_000_000, localDate: '2026-08-12' },
          { id: 'v1bbb', description: 'Убрал мусор в парке', category: 'environment', effortLevel: 2, karmaPoints: 16, createdAt: 1_755_100_000, localDate: '2026-08-13' },
          { id: 'v1ccc', description: 'Донат в фонд', category: 'donation', effortLevel: 1, karmaPoints: 12, createdAt: 1_755_200_000, localDate: '2026-08-14' },
        ],
      },
    },
  );

  assert.equal(imported.status, 200);
  assert.equal(imported.body.imported, 3);
  assert.equal(imported.body.karmaSelfTotal, 38);

  const after = karmaOf(1001);
  assert.equal(after.karma_total, before.karma_total, 'подтверждённая карма не меняется импортом');
  assert.equal(after.karma_self_total, 38);

  const rankAfter = await api<{ me: { rank: number } }>('GET', '/api/leaderboard/global', {
    initData: ANNA,
  });
  assert.equal(rankAfter.body.me.rank, rankBefore.body.me.rank);

  const legacy = await api<{ deeds: { status: string; finalScore: number | null }[] }>(
    'GET',
    '/api/deeds?status=legacy_unverified',
    { initData: ANNA },
  );
  assert.equal(legacy.body.deeds.length, 3);
  assert.ok(legacy.body.deeds.every((d) => d.finalScore === null));
});

test('повторный импорт ничего не дублирует', async () => {
  const repeat = await api<{ imported: number; alreadyImported: boolean }>('POST', '/api/import/legacy', {
    initData: ANNA,
    body: {
      deeds: [
        { id: 'v1aaa', description: 'Покормил уличных котов', category: 'animal_care', effortLevel: 1, karmaPoints: 10, createdAt: 1_755_000_000, localDate: '2026-08-12' },
      ],
    },
  });

  assert.equal(repeat.body.alreadyImported, true);
  assert.equal(repeat.body.imported, 0);
  assert.equal(karmaOf(1001).karma_self_total, 38);

  const rows = sqlRows<{ n: number }>(
    "SELECT COUNT(*) AS n FROM deeds WHERE status = 'legacy_unverified'",
  );
  assert.equal(rows[0].n, 3);
});

test('legacy-дело на ревью не отправишь', async () => {
  const legacy = sqlRows<{ id: string }>(
    "SELECT id FROM deeds WHERE status = 'legacy_unverified' LIMIT 1",
  )[0];

  const response = await api<{ error: string }>('POST', `/api/deeds/${legacy.id}/send-review`, {
    initData: ANNA,
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'deed_legacy_not_reviewable');
});

test('лидерборды: порядок по подтверждённой карме, друзья отфильтрованы', async () => {
  // Борису — 50 подтверждённой кармы, Вере — ноль.
  const boris = await deedWithLinks(BORIS);
  const forBoris = reviewersFor(BORIS);
  for (const [index, token] of boris.tokens.entries()) {
    await api('POST', `/api/review/${token}`, { initData: forBoris[index], body: { score: 50 } });
  }
  await api('GET', '/api/me', { initData: VERA });

  const global = await api<{
    entries: { id: number; karmaTotal: number; isMe: boolean; rank: number }[];
    me: { rank: number };
  }>('GET', '/api/leaderboard/global?limit=10', { initData: BORIS });

  const karmas = global.body.entries.map((e) => e.karmaTotal);
  assert.deepEqual(karmas, [...karmas].sort((a, b) => b - a), 'порядок по убыванию кармы');

  // Своя строка подсвечена, а позиция совпадает с местом в выдаче.
  const mine = global.body.entries.filter((e) => e.isMe);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].karmaTotal, 50);
  assert.equal(global.body.me.rank, mine[0].rank);

  // Вера с нулевой кармой стоит ниже Бориса.
  const zero = global.body.entries.find((e) => e.karmaTotal === 0);
  assert.ok(zero && zero.rank > mine[0].rank);

  // Друзей ещё нет: в списке только сам Борис.
  const alone = await api<{ entries: { id: number }[] }>('GET', '/api/leaderboard/friends', {
    initData: BORIS,
  });
  assert.equal(alone.body.entries.length, 1);

  const anna = await api<{ profile: { id: number } }>('GET', '/api/me', { initData: ANNA });
  const added = await api('POST', '/api/friends/add', {
    initData: BORIS,
    body: { ref: `f${anna.body.profile.id}` },
  });
  assert.equal(added.status, 200);

  // Дружба симметрична: Аня видит Бориса без встречного добавления.
  const annaFriends = await api<{ entries: { id: number; isMe: boolean }[] }>(
    'GET',
    '/api/leaderboard/friends',
    { initData: ANNA },
  );
  assert.equal(annaFriends.body.entries.length, 2);
  assert.ok(annaFriends.body.entries.some((e) => e.isMe));

  // Вера в друзья не попала.
  const vera = await api<{ profile: { id: number } }>('GET', '/api/me', { initData: VERA });
  assert.ok(!annaFriends.body.entries.some((e) => e.id === vera.body.profile.id));
});

test('профиль друга открывается по id и не показывает лишнего', async () => {
  const boris = await api<{ profile: { id: number } }>('GET', '/api/me', { initData: BORIS });

  const response = await api<{
    profile: { id: number; karmaTotal: number; badges: unknown[]; deedCount: number };
  }>('GET', `/api/users/${boris.body.profile.id}`, { initData: ANNA });

  assert.equal(response.status, 200);
  assert.equal(response.body.profile.karmaTotal, 50);
  assert.ok(Array.isArray(response.body.profile.badges));
  // Самооценённой кармы и telegram_id в чужом профиле быть не должно.
  assert.equal('karmaSelfTotal' in response.body.profile, false);
  assert.equal('telegramId' in response.body.profile, false);

  assert.equal((await api('GET', '/api/users/999999', { initData: ANNA })).status, 404);
  // Без авторизации чужой профиль не отдаём вовсе.
  assert.equal((await api('GET', `/api/users/${boris.body.profile.id}`)).status, 401);
});

test('себя в друзья добавить нельзя', async () => {
  const anna = await api<{ profile: { id: number } }>('GET', '/api/me', { initData: ANNA });
  const response = await api<{ error: string }>('POST', '/api/friends/add', {
    initData: ANNA,
    body: { ref: `f${anna.body.profile.id}` },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'cannot_add_self');
});

test('несуществующая ссылка на ревью отвечает 404, а не 500', async () => {
  const response = await api<{ error: string }>('GET', '/api/review/definitely-not-a-token', {
    initData: BORIS,
  });
  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'link_invalid');
});

test('CORS: preflight с заголовком initData разрешён', async () => {
  const response = await fetch(`http://127.0.0.1:${process.env.E2E_PORT ?? 8788}/api/me`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://karma-builder.vercel.app',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'x-telegram-init-data',
    },
  });

  assert.equal(response.status, 204);
  assert.ok(
    response.headers.get('Access-Control-Allow-Headers')?.includes('X-Telegram-Init-Data'),
  );
});

test('база после прогона остаётся консистентной', () => {
  // Ни одного дела в approved без итогового балла и наоборот.
  const broken = sqlRows<{ n: number }>(
    `SELECT COUNT(*) AS n FROM deeds
     WHERE (status = 'approved' AND final_score IS NULL)
        OR (status <> 'approved' AND final_score IS NOT NULL)`,
  );
  assert.equal(broken[0].n, 0);

  // Карма каждого юзера равна сумме итоговых баллов его подтверждённых дел.
  const mismatched = sqlRows<{ n: number }>(
    `SELECT COUNT(*) AS n FROM users u WHERE u.karma_total <> (
       SELECT COALESCE(SUM(final_score), 0) FROM deeds d
       WHERE d.user_id = u.id AND d.status = 'approved'
     )`,
  );
  assert.equal(mismatched[0].n, 0);

  resetDatabase();
});

test('потолок MAX_USERS закрывает набор новых, но не выгоняет уже заведённых', async () => {
  resetDatabase();

  // Значение берём из того же конфига, которым поднят тестовый Worker:
  // дублировать число в тесте значило бы проверять не настройку, а копию.
  const config = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'wrangler.jsonc'),
    'utf8',
  );
  const limit = Number(/"MAX_USERS"\s*:\s*"(\d+)"/.exec(config)?.[1]);
  assert.ok(Number.isInteger(limit) && limit > 0, 'MAX_USERS не найден в wrangler.jsonc');

  for (let i = 0; i < limit; i += 1) {
    const guest = signInitData(BOT_TOKEN, { id: 2000 + i, first_name: `Гость ${i}` });
    assert.equal((await api('GET', '/api/me', { initData: guest })).status, 200);
  }
  assert.equal(sqlRows<{ n: number }>('SELECT COUNT(*) AS n FROM users')[0].n, limit);

  // Подпись у следующего верная, человек настоящий — отказ именно из-за мест,
  // поэтому 403, а не 401: переоткрытие приложения ничего не изменит.
  const extra = signInitData(BOT_TOKEN, { id: 9999, first_name: 'Лишний' });
  const denied = await api<{ error: string }>('GET', '/api/me', { initData: extra });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, 'signup_closed');
  assert.equal(sqlRows<{ n: number }>('SELECT COUNT(*) AS n FROM users')[0].n, limit);

  // Закрытый набор не мешает тем, кто уже внутри.
  const inside = signInitData(BOT_TOKEN, { id: 2000, first_name: 'Гость 0' });
  assert.equal((await api('GET', '/api/me', { initData: inside })).status, 200);

  resetDatabase();
});
