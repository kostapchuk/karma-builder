'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { BADGES } from '@/lib/karma/badges';
import { DEED_CATEGORIES, levelForXp, levelTitle, minXpForLevel } from '@/lib/karma/scoring';
import { currentStreakOn, toDateKey } from '@/lib/karma/streak';
import { useAppStore } from '@/lib/store/useAppStore';
import { hapticWarning } from '@/lib/telegram/haptics';
import { CATEGORY_META, plural } from '@/lib/ui/catalog';

const LEVELS_SHOWN = 10;

export default function ProfilePage() {
  const router = useRouter();
  const state = useAppStore((s) => s.state);
  const storageKind = useAppStore((s) => s.storageKind);
  const reset = useAppStore((s) => s.reset);

  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const level = levelForXp(state.totalKarma);
  const earned = new Map(state.badges.map((b) => [b.code, b] as const));
  const streak = currentStreakOn(state.streak, toDateKey(new Date()));
  const maxCategoryCount = Math.max(1, ...state.categoryCounts);

  async function handleReset() {
    setResetting(true);
    hapticWarning();
    try {
      await reset();
      router.replace('/');
    } finally {
      setResetting(false);
      setConfirming(false);
    }
  }

  return (
    <main className="page">
      <h1 className="karma-total" style={{ fontSize: 24 }}>
        Профиль
      </h1>

      <div className="stats">
        <div className="stat">
          <b>{state.totalKarma}</b>
          <span>кармы</span>
        </div>
        <div className="stat">
          <b>🔥 {streak}</b>
          <span>текущий стрик</span>
        </div>
        <div className="stat">
          <b>🏅 {state.streak.longestStreak}</b>
          <span>рекорд</span>
        </div>
      </div>

      <section>
        <h2 className="section-title">
          Бейджи · {state.badges.length} из {BADGES.length}
        </h2>
        <div className="badge-grid">
          {BADGES.map((def) => {
            const got = earned.get(def.code);
            return (
              <div className={`badge${got ? '' : ' locked'}`} key={def.code}>
                <div className="emoji">{def.icon}</div>
                <b>{def.title}</b>
                <span>{def.description}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="section-title">По категориям</h2>
        <div className="card">
          {state.deedCount === 0 ? (
            <div className="hint">Пока нет данных</div>
          ) : (
            DEED_CATEGORIES.map((code, i) => {
              const count = state.categoryCounts[i] ?? 0;
              return (
                <div className="bar-row" key={code}>
                  <span className="label">
                    {CATEGORY_META[code].icon} {CATEGORY_META[code].label}
                  </span>
                  <span className="bar">
                    <i style={{ width: `${(count / maxCategoryCount) * 100}%` }} />
                  </span>
                  <span className="count">{count}</span>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section>
        <h2 className="section-title">Кривая уровней</h2>
        <div className="card">
          {Array.from({ length: LEVELS_SHOWN }, (_, i) => i + 1).map((n) => {
            const reached = level >= n;
            return (
              <div
                className={`level-row${level === n ? ' current' : ''}${reached ? '' : ' locked'}`}
                key={n}
              >
                <span className="num">{n}</span>
                <span>{levelTitle(n)}</span>
                <span className="spacer" />
                <span className="hint">{minXpForLevel(n)} XP</span>
              </div>
            );
          })}
        </div>
        {level > LEVELS_SHOWN && (
          <div className="hint" style={{ padding: '8px 4px 0' }}>
            Текущий: ур. {level} · {levelTitle(level)}
          </div>
        )}
      </section>

      <section>
        <h2 className="section-title">Данные</h2>
        <div className="card">
          <div className="hint">
            {storageKind === 'cloud'
              ? 'Telegram CloudStorage: дела синхронизируются между вашими устройствами.'
              : 'Локальное хранилище: данные есть только на этом устройстве.'}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {state.deedCount} {plural(state.deedCount, 'дело', 'дела', 'дел')} ·{' '}
            {state.lastChunk + 1} {plural(state.lastChunk + 1, 'чанк', 'чанка', 'чанков')}
          </div>
        </div>
      </section>

      {confirming ? (
        <div className="card">
          <div style={{ marginBottom: 12 }}>
            Удалить все дела, карму и бейджи? Отменить это будет нельзя.
          </div>
          <button className="btn danger" disabled={resetting} onClick={handleReset}>
            {resetting ? 'Удаляем…' : 'Да, удалить всё'}
          </button>
          <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => setConfirming(false)}>
            Отмена
          </button>
        </div>
      ) : (
        <button className="btn danger" onClick={() => setConfirming(true)}>
          Сбросить данные
        </button>
      )}
    </main>
  );
}
