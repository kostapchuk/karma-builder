-- Самооценка из V1 убрана целиком: и логика, и данные.
--
-- Замысел был в двух шкалах — подтверждённая карма шла в рейтинг, перенесённая
-- из V1 висела рядом как память о прошлом прогрессе. На практике вторая шкала
-- только путала: трекаем то, что подтвердил кто-то посторонний, остальное
-- значения не имеет.

-- 1. Перенесённые дела и всё, что могло к ним прицепиться.
DELETE FROM reviews WHERE deed_id IN (SELECT id FROM deeds WHERE status = 'legacy_unverified');
DELETE FROM review_tokens WHERE deed_id IN (SELECT id FROM deeds WHERE status = 'legacy_unverified');
DELETE FROM deeds WHERE status = 'legacy_unverified';

-- 2. Агрегаты в `users` считались вместе с перенесёнными делами и теперь врут.
--    Пересчитываем от того, что осталось. Порядок категорий — DEED_CATEGORIES
--    на момент миграции; она снимок этого момента, поздние правки каталога её
--    не касаются.
UPDATE users SET
  deed_count = (SELECT COUNT(*) FROM deeds d WHERE d.user_id = users.id),
  category_counts = '[' ||
    (SELECT COUNT(*) FROM deeds d WHERE d.user_id = users.id AND d.category = 'helping_person') || ',' ||
    (SELECT COUNT(*) FROM deeds d WHERE d.user_id = users.id AND d.category = 'animal_care') || ',' ||
    (SELECT COUNT(*) FROM deeds d WHERE d.user_id = users.id AND d.category = 'environment') || ',' ||
    (SELECT COUNT(*) FROM deeds d WHERE d.user_id = users.id AND d.category = 'volunteering') || ',' ||
    (SELECT COUNT(*) FROM deeds d WHERE d.user_id = users.id AND d.category = 'donation') || ',' ||
    (SELECT COUNT(*) FROM deeds d WHERE d.user_id = users.id AND d.category = 'kindness_gesture') || ',' ||
    (SELECT COUNT(*) FROM deeds d WHERE d.user_id = users.id AND d.category = 'self_improvement') || ',' ||
    (SELECT COUNT(*) FROM deeds d WHERE d.user_id = users.id AND d.category = 'other') || ']',
  last_deed_date = (SELECT MAX(d.local_date) FROM deeds d WHERE d.user_id = users.id);

-- 3. Стрик тоже сливался с историей V1. Считаем заново: подряд идущие
--    календарные дни — это группы, у которых `дата минус её номер по порядку`
--    совпадает. Дни без дел разрывают такую группу.
UPDATE users SET streak_longest = COALESCE((
  WITH days AS (SELECT DISTINCT local_date FROM deeds WHERE user_id = users.id),
       runs AS (
         SELECT date(local_date, '-' || ROW_NUMBER() OVER (ORDER BY local_date) || ' days') AS anchor
         FROM days
       )
  SELECT MAX(len) FROM (SELECT COUNT(*) AS len FROM runs GROUP BY anchor)
), 0);

UPDATE users SET streak_current = COALESCE((
  WITH days AS (SELECT DISTINCT local_date FROM deeds WHERE user_id = users.id),
       runs AS (
         SELECT local_date,
                date(local_date, '-' || ROW_NUMBER() OVER (ORDER BY local_date) || ' days') AS anchor
         FROM days
       )
  SELECT COUNT(*) FROM runs
   WHERE anchor = (SELECT anchor FROM runs ORDER BY local_date DESC LIMIT 1)
), 0);

-- 4. Сами колонки. Бейджи не трогаем: они личные достижения, а не рейтинг, —
--    отбирать уже выданное незачем (та же логика, что при импорте).
ALTER TABLE users DROP COLUMN karma_self_total;
ALTER TABLE users DROP COLUMN legacy_imported_at;

-- CHECK на `deeds.status` по-прежнему допускает 'legacy_unverified': снять его
-- в SQLite можно только пересборкой таблицы, на которую смотрят внешние ключи
-- `reviews` и `review_tokens`. Значение теперь не пишет никто, поэтому лишний
-- вариант в перечислении безвреден.
