'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { DeedList } from '@/components/DeedList';
import { HEATMAP_PERIOD, Heatmap } from '@/components/Heatmap';
import type { DeedStatus } from '@/lib/api/types';
import { DEED_CATEGORIES } from '@/lib/karma/scoring';
import type { DeedCategory } from '@/lib/karma/types';
import { useAppStore } from '@/lib/store/useAppStore';
import { CATEGORY_META, plural } from '@/lib/ui/catalog';

/** Фильтры по состоянию дела: в V2 это первое, о чём спрашивают историю. */
const STATUS_FILTERS: { code: DeedStatus | null; label: string }[] = [
  { code: null, label: 'Все' },
  { code: 'approved', label: 'Подтверждённые' },
  { code: 'pending', label: 'На проверке' },
];

export default function HistoryPage() {
  const router = useRouter();
  const deeds = useAppStore((s) => s.deeds);

  const [category, setCategory] = useState<DeedCategory | null>(null);
  const [status, setStatus] = useState<DeedStatus | null>(null);

  const visible = useMemo(
    () =>
      deeds.filter((deed) => {
        if (category && deed.category !== category) return false;
        if (!status) return true;
        // «На ревью» — это два статуса: ждём обоих и ждём второго.
        if (status === 'pending') {
          return deed.status === 'pending' || deed.status === 'partially_reviewed';
        }
        return deed.status === status;
      }),
    [deeds, category, status],
  );

  const usedCategories = DEED_CATEGORIES.filter((code) =>
    deeds.some((deed) => deed.category === code),
  );
  const confirmed = deeds
    .filter((deed) => deed.status === 'approved')
    .reduce((sum, deed) => sum + (deed.finalScore ?? 0), 0);

  return (
    <main className="page">
      <h1 className="karma-total" style={{ fontSize: 24 }}>
        История
      </h1>

      {deeds.length > 0 && (
        <section className="card">
          <div className="section-title" style={{ margin: '0 0 10px' }}>
            Активность {HEATMAP_PERIOD}
          </div>
          <Heatmap deeds={deeds} />
          <div className="hint" style={{ marginTop: 10 }}>
            Подтверждено {confirmed} кармы за {deeds.filter((d) => d.status === 'approved').length}{' '}
            {plural(deeds.filter((d) => d.status === 'approved').length, 'дело', 'дела', 'дел')}
          </div>
        </section>
      )}

      <div className="filters">
        {STATUS_FILTERS.map((item) => (
          <button
            key={item.label}
            type="button"
            className="filter"
            aria-pressed={status === item.code}
            onClick={() => setStatus(item.code)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {usedCategories.length > 1 && (
        <div className="filters">
          <button
            type="button"
            className="filter"
            aria-pressed={category === null}
            onClick={() => setCategory(null)}
          >
            Все категории
          </button>
          {usedCategories.map((code) => (
            <button
              key={code}
              type="button"
              className="filter"
              aria-pressed={category === code}
              onClick={() => setCategory(category === code ? null : code)}
            >
              {CATEGORY_META[code].icon} {CATEGORY_META[code].label}
            </button>
          ))}
        </div>
      )}

      <div className="hint" style={{ padding: '0 4px' }}>
        {visible.length} {plural(visible.length, 'дело', 'дела', 'дел')}
      </div>

      <DeedList
        deeds={visible}
        empty="Под эти фильтры ничего не подошло."
        onSelect={(deed) => router.push(`/deed/?id=${deed.id}`)}
      />
    </main>
  );
}
