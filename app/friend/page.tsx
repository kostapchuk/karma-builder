'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { api } from '@/lib/api/client';
import type { FriendProfileResponse } from '@/lib/api/types';
import { BADGES } from '@/lib/karma/badges';
import { plural } from '@/lib/ui/catalog';

/** Профиль другого человека: только чтение и только то, что не стыдно показать. */
export default function FriendPage() {
  return (
    <Suspense fallback={<main className="page"><div className="empty">Загружаем…</div></main>}>
      <FriendProfile />
    </Suspense>
  );
}

function FriendProfile() {
  const id = Number(useSearchParams().get('id'));
  const [data, setData] = useState<FriendProfileResponse['profile'] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!Number.isSafeInteger(id) || id <= 0) {
      setFailed(true);
      return;
    }
    api
      .friendProfile(id)
      .then((response) => setData(response.profile))
      .catch(() => setFailed(true));
  }, [id]);

  if (failed) {
    return (
      <main className="page">
        <div className="empty">
          <span className="emoji">🙈</span>
          Профиль не найден
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="page">
        <div className="empty">Загружаем профиль…</div>
      </main>
    );
  }

  const earned = new Map(data.badges.map((badge) => [badge.code, badge] as const));

  return (
    <main className="page">
      <section className="card" style={{ textAlign: 'center' }}>
        <div className="karma-total" style={{ fontSize: 38 }}>
          {data.karmaTotal}
        </div>
        <div className="hint">подтверждённой кармы</div>
        <div className="level-title" style={{ marginTop: 10 }}>
          {data.firstName ?? data.username ?? 'Без имени'}
        </div>
        <div className="hint">
          Ур. {data.level} · {data.levelTitle}
        </div>
      </section>

      <div className="stats">
        <div className="stat">
          <b>{data.deedCount}</b>
          <span>{plural(data.deedCount, 'дело', 'дела', 'дел')}</span>
        </div>
        <div className="stat">
          <b>🏅 {data.longestStreak}</b>
          <span>рекорд стрика</span>
        </div>
        <div className="stat">
          <b>{data.badges.length}</b>
          <span>{plural(data.badges.length, 'бейдж', 'бейджа', 'бейджей')}</span>
        </div>
      </div>

      <section>
        <h2 className="section-title">Бейджи</h2>
        <div className="badge-grid">
          {BADGES.map((def) => (
            <div className={`badge${earned.has(def.code) ? '' : ' locked'}`} key={def.code}>
              <div className="emoji">{def.icon}</div>
              <b>{def.title}</b>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
