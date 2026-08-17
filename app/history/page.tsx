'use client';

import { useEffect, useMemo, useState } from 'react';

import { DeedList } from '@/components/DeedList';
import { Heatmap } from '@/components/Heatmap';
import { DEED_CATEGORIES } from '@/lib/karma/scoring';
import type { DeedCategory } from '@/lib/karma/types';
import { useAppStore } from '@/lib/store/useAppStore';
import { CATEGORY_META, plural } from '@/lib/ui/catalog';

export default function HistoryPage() {
  const deeds = useAppStore((s) => s.deeds);
  const historyStatus = useAppStore((s) => s.historyStatus);
  const loadHistory = useAppStore((s) => s.loadHistory);
  const categoryCounts = useAppStore((s) => s.state.categoryCounts);

  const [filter, setFilter] = useState<DeedCategory | null>(null);

  // Чанки дел грузим лениво — ровно здесь, а не на старте приложения.
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const visible = useMemo(
    () => (filter ? deeds.filter((d) => d.category === filter) : deeds),
    [deeds, filter],
  );

  // Фильтры показываем только для категорий, в которых что-то есть.
  const usedCategories = DEED_CATEGORIES.filter((_, i) => (categoryCounts[i] ?? 0) > 0);

  if (historyStatus === 'loading' || historyStatus === 'idle') {
    return (
      <main className="page">
        <div className="empty">
          <span className="emoji">📜</span>
          Загружаем историю…
        </div>
      </main>
    );
  }

  if (historyStatus === 'error') {
    return (
      <main className="page">
        <div className="empty">
          <span className="emoji">😕</span>
          Не удалось загрузить историю
          <p>
            <button className="btn secondary" onClick={() => void loadHistory(true)}>
              Повторить
            </button>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <h1 className="karma-total" style={{ fontSize: 24 }}>
        История
      </h1>

      {deeds.length > 0 && (
        <section className="card">
          <div className="section-title" style={{ margin: '0 0 10px' }}>
            Активность за полгода
          </div>
          <Heatmap deeds={deeds} />
        </section>
      )}

      {usedCategories.length > 1 && (
        <div className="filters">
          <button
            type="button"
            className="filter"
            aria-pressed={filter === null}
            onClick={() => setFilter(null)}
          >
            Все · {deeds.length}
          </button>
          {usedCategories.map((code) => (
            <button
              key={code}
              type="button"
              className="filter"
              aria-pressed={filter === code}
              onClick={() => setFilter(filter === code ? null : code)}
            >
              {CATEGORY_META[code].icon} {CATEGORY_META[code].label}
            </button>
          ))}
        </div>
      )}

      <div className="hint" style={{ padding: '0 4px' }}>
        {visible.length} {plural(visible.length, 'дело', 'дела', 'дел')}
      </div>

      <DeedList deeds={visible} />
    </main>
  );
}
