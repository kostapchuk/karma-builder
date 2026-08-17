'use client';

import type { Deed } from '@/lib/karma/types';
import { CATEGORY_META, EFFORT_META, formatDeedTime } from '@/lib/ui/catalog';

export function DeedList({ deeds }: { deeds: Deed[] }) {
  if (deeds.length === 0) {
    return (
      <div className="empty">
        <span className="emoji">🌱</span>
        Пока ни одного дела. Первое — самое ценное.
      </div>
    );
  }

  return (
    <div className="deed-list">
      {deeds.map((deed) => {
        const meta = CATEGORY_META[deed.category];
        return (
          <div className="deed" key={deed.id}>
            <span className="icon">{meta.icon}</span>
            <span className="body">
              <b>{deed.description || meta.label}</b>
              <span>
                {meta.label} · {EFFORT_META[deed.effortLevel].label} ·{' '}
                {formatDeedTime(deed.createdAt)}
              </span>
            </span>
            <span className="points">+{deed.karmaPoints}</span>
          </div>
        );
      })}
    </div>
  );
}
