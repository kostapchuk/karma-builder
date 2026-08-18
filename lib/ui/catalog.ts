/** Представление домена: подписи и иконки. Из scoring.ts вынесено намеренно —
 *  тот модуль в V2 работает на сервере, где русские подписи не нужны. */

import type { DeedCategory, EffortLevel } from '../karma/types';

export const CATEGORY_META: Record<DeedCategory, { label: string; icon: string }> = {
  volunteering: { label: 'Волонтёрство', icon: '🤝' },
  donation: { label: 'Пожертвование', icon: '💝' },
  helping_person: { label: 'Помощь человеку', icon: '🙌' },
  animal_care: { label: 'Забота о животных', icon: '🐾' },
  environment: { label: 'Экология', icon: '🌍' },
  self_improvement: { label: 'Работа над собой', icon: '📚' },
  kindness_gesture: { label: 'Жест доброты', icon: '💛' },
  other: { label: 'Другое', icon: '✨' },
};

export const EFFORT_META: Record<EffortLevel, { label: string; hint: string }> = {
  1: { label: 'Немного', hint: 'до 15 минут' },
  2: { label: 'Средне', hint: 'около часа' },
  3: { label: 'Много', hint: 'значимое время' },
};

const RU_MONTHS = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

/** «Сегодня, 14:03» / «12 авг, 09:41» — короткая подпись под делом. */
export function formatDeedTime(epochSeconds: number, now: Date = new Date()): string {
  const date = new Date(epochSeconds * 1000);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay(date, now)) return `Сегодня, ${time}`;
  if (sameDay(date, yesterday)) return `Вчера, ${time}`;

  const day = `${date.getDate()} ${RU_MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear()
    ? `${day}, ${time}`
    : `${day} ${date.getFullYear()}`;
}

/** Правильная форма русского существительного: 1 дело / 2 дела / 5 дел. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
