'use client';

import { useMemo } from 'react';

import type { DeedView } from '@/lib/api/types';
import { toDateKey } from '@/lib/karma/streak';
import { plural } from '@/lib/ui/catalog';

const WEEKS = 26;
const DAYS = WEEKS * 7;

/** Календарь активности как у GitHub-контрибуций — за последние полгода. */
export function Heatmap({ deeds }: { deeds: DeedView[] }) {
  const cells = useMemo(() => {
    const counts = new Map<string, number>();
    for (const deed of deeds) {
      // localDate посчитан на устройстве автора: сервер живёт в UTC и день
      // на границе суток определил бы иначе.
      counts.set(deed.localDate, (counts.get(deed.localDate) ?? 0) + 1);
    }

    // Сетка идёт колонками по неделям, поэтому начинаем с понедельника:
    // иначе последний столбец «съедет» относительно строк-дней недели.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekdayFromMonday = (today.getDay() + 6) % 7;
    const start = new Date(today);
    start.setDate(today.getDate() - (DAYS - 1 - (6 - weekdayFromMonday)));

    return Array.from({ length: DAYS }, (_, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const key = toDateKey(date);
      const count = counts.get(key) ?? 0;
      return { key, count, future: date > today };
    });
  }, [deeds]);

  return (
    <div className="heatmap">
      {cells.map((cell) => (
        <i
          key={cell.key}
          data-level={cell.future ? undefined : intensity(cell.count)}
          title={`${cell.key}: ${cell.count} ${plural(cell.count, 'дело', 'дела', 'дел')}`}
          style={cell.future ? { opacity: 0.25 } : undefined}
        />
      ))}
    </div>
  );
}

function intensity(count: number): number {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}
