/**
 * Калибровка рецензента (V2).
 *
 * Рецензент — человек без контекста: без общей шкалы оценки за одно и то же
 * дело разъедутся в разы. Якоря одинаковы для всех дел и показываются рядом
 * со слайдером, а `base_score` конкретного дела идёт отдельной подсказкой.
 *
 * Модуль чистый: используется и Worker'ом, и страницей рецензента.
 */

export interface ScoreAnchor {
  example: string;
  /** Подпись под делением шкалы: полный пример туда не влезает. */
  short: string;
  score: number;
}

export const REVIEW_ANCHORS: readonly ScoreAnchor[] = [
  { example: 'Уступил место в транспорте пожилому человеку', short: 'уступил место', score: 5 },
  { example: 'Отвёз друга в другой город, потратил полдня', short: 'потратил полдня', score: 20 },
  { example: 'Организовал сбор вещей для приюта, весь выходной', short: 'весь выходной', score: 40 },
] as const;

export const MIN_REVIEW_SCORE = 0;
/** Потолок отсекает абсурд и совпадает по масштабу с максимумом V1-эвристики (45). */
export const MAX_REVIEW_SCORE = 50;

export const REVIEW_COMMENT_MAX_LENGTH = 280;

/**
 * Сколько людей оценивают одно дело; итог — среднее их оценок.
 *
 * Единственный регулятор: от длины этого списка зависят и число выдаваемых
 * ссылок, и порог, после которого дело уходит в approved. Возврат к двум
 * рецензентам — правка одной строки, схема БД (`CHECK(reviewer_slot IN (1,2))`)
 * второй слот по-прежнему допускает.
 *
 * Сейчас один: на старте у пользователей нет двоих готовых оценить, и дело
 * зависало бы в partially_reviewed. Усреднение двух независимых оценок было
 * защитой от накрутки — с одним рецензентом её нет, и это осознанный размен
 * на время раскатки.
 */
export const REVIEWER_SLOTS = [1] as const;
export type ReviewerSlot = (typeof REVIEWER_SLOTS)[number];

export function isValidScore(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_REVIEW_SCORE &&
    value <= MAX_REVIEW_SCORE
  );
}
