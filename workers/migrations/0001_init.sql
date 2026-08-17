-- V2, начальная схема.
--
-- Отличия от эскиза в docs/v2-reviews.md — все в таблице users и все по одной
-- причине: экраны V2 (профиль, профиль друга, /api/me) показывают стрик и бейджи,
-- а считать их запросом по всей истории дел на каждый вызов дороже, чем держать
-- агрегат в строке юзера. Раскладка повторяет `state` из V1.
--
--   streak_current / streak_longest / last_deed_date — стрик (lib/karma/streak.ts)
--   deed_count / category_counts / badges            — контекст выдачи бейджей
--   legacy_imported_at                               — серверный флаг импорта V1
--
-- В deeds добавлен local_date: день считается в зоне пользователя, а Worker живёт
-- в UTC. Без этой колонки стрик и heatmap разъезжались бы на границе суток.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL UNIQUE,
  username TEXT, first_name TEXT, photo_url TEXT,
  karma_total INTEGER NOT NULL DEFAULT 0,       -- подтверждённая ревью
  karma_self_total INTEGER NOT NULL DEFAULT 0,  -- самооценённая, из V1
  level INTEGER NOT NULL DEFAULT 1,
  streak_current INTEGER NOT NULL DEFAULT 0,
  streak_longest INTEGER NOT NULL DEFAULT 0,
  last_deed_date TEXT,                          -- YYYY-MM-DD в зоне пользователя
  deed_count INTEGER NOT NULL DEFAULT 0,
  category_counts TEXT NOT NULL DEFAULT '[]',   -- JSON, порядок DEED_CATEGORIES
  badges TEXT NOT NULL DEFAULT '[]',            -- JSON [[code, earnedAt], ...]
  legacy_imported_at TEXT,
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
  local_date TEXT NOT NULL,            -- YYYY-MM-DD в зоне пользователя
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
  revoked_at TEXT,                     -- проставляется при перегенерации ссылки
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
CREATE INDEX idx_review_tokens_deed ON review_tokens(deed_id);
CREATE INDEX idx_review_tokens_expires ON review_tokens(expires_at) WHERE used_at IS NULL;
CREATE INDEX idx_reviews_deed ON reviews(deed_id);
CREATE INDEX idx_users_karma ON users(karma_total DESC);
