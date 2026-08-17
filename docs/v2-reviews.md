# Karma Contributor — V2: peer-ревью, Workers + D1

## Что добавляется к V1

[V1](./v1-mini-app.md) — личный трекер: пользователь сам записывает дело и сам получает за него баллы. V2 добавляет **верификацию дел другими людьми** и социальный слой:

- Дело отправляется на ревью **двум людям**, которые могут вообще не быть пользователями приложения — они получают обычную веб-ссылку и открывают её в любом браузере, без логина и регистрации.
- Каждый рецензент ставит свою оценку; итоговый балл — **среднее двух оценок**.
- Появляются **лидерборд друзей** и **глобальный рейтинг**.

Технически это означает появление бэкенда: **Cloudflare Workers + D1**.

**Что переиспользуется из V1 без изменений:** эвристика начисления баллов (веса категорий × множитель усилия, 5–45 очков) и кривая уровней `minXp(N) = 25 × (N−1) × N`. Числа и таблицы — в [v1-mini-app.md](./v1-mini-app.md), здесь они не дублируются. Модуль `lib/karma/scoring.ts` из V1 подключается к Worker'у как есть — поэтому в V1 он и пишется без зависимостей от React и браузерных API.

---

## Топология

- **Mini App** — тот же интерфейс, что в V1, плюс экраны ревью и лидерборда. Данные переезжают из CloudStorage в D1.
- **Reviewer page** — отдельная React SPA **вне** Mini App, на Cloudflare Pages. Открывается в любом браузере по одноразовой ссылке, **без логина и регистрации**.
- **Workers + D1** — API и хранилище.

---

## Схема D1

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL UNIQUE,
  username TEXT, first_name TEXT, photo_url TEXT,
  karma_total INTEGER NOT NULL DEFAULT 0,       -- подтверждённая ревью
  karma_self_total INTEGER NOT NULL DEFAULT 0,  -- самооценённая, из V1
  level INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT
);

CREATE TABLE deeds (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  effort_level INTEGER NOT NULL,       -- 1/2/3
  base_score INTEGER NOT NULL,         -- эвристика V1; подсказка ревьюерам
  final_score REAL,                    -- среднее двух оценок, NULL пока не готово
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','partially_reviewed','approved','rejected','expired','legacy_unverified')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE review_tokens (
  token TEXT PRIMARY KEY,              -- nanoid(32) из crypto.getRandomValues
  deed_id TEXT NOT NULL REFERENCES deeds(id),
  reviewer_slot INTEGER NOT NULL CHECK(reviewer_slot IN (1,2)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,            -- created_at + 72h
  used_at TEXT,
  UNIQUE(deed_id, reviewer_slot)
);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deed_id TEXT NOT NULL REFERENCES deeds(id),
  reviewer_slot INTEGER NOT NULL CHECK(reviewer_slot IN (1,2)),
  score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 50),
  comment TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(deed_id, reviewer_slot)
);

CREATE TABLE friendships (
  user_id INTEGER NOT NULL REFERENCES users(id),
  friend_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('pending','accepted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, friend_id)
);

CREATE INDEX idx_deeds_user ON deeds(user_id);
CREATE INDEX idx_deeds_status ON deeds(status);
CREATE INDEX idx_review_tokens_expires ON review_tokens(expires_at) WHERE used_at IS NULL;
CREATE INDEX idx_users_karma ON users(karma_total DESC);
```

Две детали, которые стоит объяснить:

- **`UNIQUE(deed_id, reviewer_slot)`** в обеих таблицах — это не украшение, а несущая конструкция: именно она делает невозможной двойную оценку от одного слота и служит триггером для агрегации (см. ниже).
- **Дружба хранится двумя симметричными строками** (A→B и B→A, обе `accepted`) — запрос «мои друзья» становится простым `WHERE user_id = ?` без `OR` и `UNION`.

---

## Референс оценок для рецензента

Рецензент — человек без контекста, ему нужна калибровка, иначе оценки будут разъезжаться в разы. На странице ревью показываем:

**1. Три фиксированных якоря** (одинаковые для всех дел):

| Пример | Баллы |
|---|---|
| «Уступил место в транспорте пожилому человеку» | 5 |
| «Отвёз друга в другой город, потратил полдня» | 20 |
| «Организовал сбор вещей для приюта, весь выходной» | 40 |

**2. `base_score` конкретного дела** — ненавязчивая подсказка «система предлагает N».

**3. Слайдер 0–50** + необязательный комментарий.

Потолок 50 отсекает абсурдные значения и совпадает по масштабу с V1-эвристикой (максимум 45). Двойное якорение — общие примеры плюс системная подсказка — снижает разброс между двумя независимыми оценками, оставляя при этом место человеческому суждению.

---

## Жизненный цикл review-токенов

При отправке дела на ревью создаются 2 токена (`nanoid(32)` из `crypto.getRandomValues`), `expires_at = now + 72h`. Ссылки вида `https://<review-domain>/r/{token}` рассылаются через нативный Telegram share (`shareURL` / `openTelegramLink`).

**Одноразовость.** Атомарно `UPDATE review_tokens SET used_at=? WHERE token=? AND used_at IS NULL`, затем `INSERT INTO reviews` — обе операции в одном `db.batch()`. Без этого двойной сабмит проскочит в гонке.

**Агрегация.** Когда проходит второй `INSERT` в `reviews` (что гарантируется ограничением `UNIQUE(deed_id, reviewer_slot)`), Worker одним `db.batch()`:
1. `final_score = round((score1 + score2) / 2)`
2. `deeds.status = 'approved'`, проставляет `final_score` и `resolved_at`
3. инкрементирует `users.karma_total`
4. пересчитывает `users.level` по общей кривой

**Рецензент не ответил — без cron.** По истечении `expires_at` автор видит в экране «На ревью» статус «ссылка истекла» и жмёт «перегенерировать»: старый токен инвалидируется, создаётся новый для того же слота. Проверка `expires_at` ленивая, в момент чтения — в D1 нет TTL, а поднимать Durable Objects ради этого на MVP незачем. Часовой Cron Trigger, проставляющий `status='expired'`, можно добавить позже как усиление: он бесплатен, но не обязателен.

**Anti-abuse.** Rate-limit на маршрут ревью (правила Cloudflare или счётчик в KV). Само усреднение двух независимых оценок уже гасит накрутку одним человеком — на MVP сложнее защиты не нужно.

---

## Telegram auth

В V1 никакой аутентификации не было — сервера не существовало. В V2 она появляется вместе с бэкендом.

- Mini App шлёт `Telegram.WebApp.initData` в заголовке каждого запроса.
- Worker валидирует по алгоритму Telegram: `secret_key = HMAC_SHA256(key="WebAppData", message=BOT_TOKEN)`, затем сверяет `HMAC_SHA256(key=secret_key, message=data_check_string)` с полем `hash`. Дополнительно отклоняет `auth_date` старше ~24 часов — защита от replay.
- Первая успешная валидация → upsert в `users` по `telegram_id`.
- **Сессий не заводим**: валидируем `initData` на каждый запрос. HMAC в Workers дешёвый, а SDK всегда отдаёт свежий `initData` — это убирает целый класс задач (хранение сессий, revoke, refresh).
- `BOT_TOKEN` — секрет Workers (`wrangler secret put`), никогда в бандле.

---

## API (Workers routes)

| Метод | Путь | Auth | Назначение |
|---|---|---|---|
| POST | `/api/deeds` | initData | создать дело, `base_score` по общей эвристике, `status='pending'` |
| GET | `/api/deeds` | initData | история пользователя |
| GET | `/api/deeds/:id` | initData | детали + статус по слотам |
| POST | `/api/deeds/:id/send-review` | initData | сгенерировать/перегенерировать токены, вернуть ссылки |
| GET | `/api/review/:token` | публично | дело + якоря, проверка срока и использования |
| POST | `/api/review/:token` | публично | сабмит `{score, comment}`; при заполнении обоих слотов — агрегация |
| GET | `/api/me` | initData | профиль (карма, уровень, streak) |
| GET | `/api/leaderboard/friends` | initData | рейтинг друзей (один JOIN, без N+1) |
| GET | `/api/leaderboard/global` | публично | глобальный топ, пагинация, top-100 кэшировать |
| POST | `/api/friends/add` | initData | добавление через deep-link (`start`-параметр с id инициатора) |
| POST | `/api/import/legacy` | initData | одноразовый импорт дел из CloudStorage (см. ниже) |

Создание дела и отправка на ревью — **два отдельных шага**. Это даёт пользователю контроль: записать дело вечером, а разослать ссылки утром.

---

## Миграция V1 → V2

Раз V1 уже Mini App, `telegram_id` известен — никаких файлов экспорта и ручного переноса. При первом запуске V2 клиент читает CloudStorage и один раз отправляет дела в `/api/import/legacy`; ключ `meta` помечается флагом `imported`, чтобы импорт не повторился.

**Две раздельные шкалы кармы вместо обнуления:**

- Импортированные дела ложатся со `status='legacy_unverified'`, `final_score=NULL`, а их сумма идёт в **`karma_self_total`**, не в `karma_total`.
- Лидерборды строятся **только по `karma_total`** (подтверждённой). Иначе накрученные локальные баллы «отмывались» бы в глобальный рейтинг, и весь смысл ревью терялся.
- В профиле показываем обе цифры: «Подтверждено: N · Самооценка: M». Прогресс из V1 не исчезает и остаётся видимым, но на общий рейтинг не влияет.

Отдельной миграционной инфраструктуры не требуется: один дополнительный статус в существующем enum, одна колонка и один endpoint.

---

## Лимиты бесплатных тарифов

- **Workers free**: 100k запросов/день, ~10 мс CPU на вызов. HMAC + запросы к D1 укладываются, но агрегацию ревью нужно держать одним `db.batch()`, а не цепочкой round-trip'ов.
- **D1 free**: ~5 ГБ хранилища плюс дневные лимиты на чтение/запись строк — актуальные цифры сверить перед стартом, Cloudflare их периодически меняет. Для hobby-масштаба с запасом. Избегать N+1 в лидерборде друзей.
- **В D1 нет TTL** — истечение токенов проверяем лениво по `expires_at`; Durable Objects и Cron для MVP не нужны.
- **Cloudflare Pages** (reviewer page): бесплатно, статика без лимита запросов.
- **Vercel Hobby** (Mini App): 100 ГБ трафика/мес; сборка статична, так что при желании всё консолидируется на Pages.
- **Telegram CloudStorage** (актуально до миграции): 1024 ключа × 4096 символов, потолок ~20k дел при раскладке из V1.
- **Telegram Bot API**: 30 msg/сек — не узкое место на этом масштабе.

---

## Экраны (поверх V1)

- **Home** — плюс счётчик «На ревью».
- **Add Deed** — та же форма плюс шаг «Отправить на ревью» с нативным share двух ссылок.
- **На ревью** — список ожидающих дел, статус по каждому слоту, перегенерация истёкшей ссылки.
- **History** — подтверждённые дела с `final_score`, отдельной пометкой `legacy_unverified`.
- **Leaderboard** — табы «Друзья» / «Глобальный», позиция, аватар, карма, уровень, подсветка своей строки.
- **Профиль друга** — read-only: карма, уровень, бейджи.
- **Reviewer page** (вне Telegram, без логина) — описание дела, 3 якоря, слайдер 0–50, комментарий, экран благодарности либо «ссылка недействительна».

---

## Порядок реализации

1. **`workers/schema.sql`** — DDL, применить через `wrangler d1 migrations`.
2. **`workers/src/auth/telegramAuth.ts`** — валидация initData (HMAC + `auth_date`), upsert юзера.
3. CRUD дел + `send-review` (генерация токенов).
4. **`workers/src/routes/review.ts`** — самая критичная часть: одноразовость токена и атомарная агрегация двух оценок в одном batch.
5. Reviewer SPA на Cloudflare Pages.
6. Лидерборды и друзья через deep-link.
7. **`/api/import/legacy`** — одноразовый перенос дел из CloudStorage в `karma_self_total`.

---

## Верификация

Локально: `wrangler dev` + `wrangler d1 execute --local`.

- **Auth**: подделанный `hash` → 401; просроченный `auth_date` → 401; валидный → upsert юзера.
- **Ревью end-to-end**: создать дело → получить 2 ссылки → открыть каждую в отдельном приватном окне (симуляция внешних людей) → выставить 20 и 30 → `final_score = 25`, `status='approved'`, `karma_total` вырос ровно на 25.
- **Одноразовость**: повторный сабмит по использованному токену → отказ. Два параллельных сабмита по одному токену (`curl` в фоне ×2) → ровно одна запись в `reviews`.
- **Истечение**: вручную выставить `expires_at` в прошлое → страница показывает «недействительна», перегенерация выдаёт новый рабочий токен.
- **Лидерборд**: 3+ тестовых юзера с разной кармой → корректный порядок, друзья фильтруются, своя строка подсвечена.
- **Импорт**: запустить с непустым CloudStorage → дела появились со `status='legacy_unverified'`, выросла `karma_self_total`, **`karma_total` не изменилась**, позиция в лидерборде не сдвинулась. Повторный запуск импорт не дублирует.
