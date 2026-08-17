'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { initDataUser } from '@telegram-apps/sdk-react';

import { DeedList } from '@/components/DeedList';
import { useMainButton } from '@/components/useMainButton';
import { levelForXp, levelProgress, levelTitle, minXpForLevel } from '@/lib/karma/scoring';
import { currentStreakOn, toDateKey } from '@/lib/karma/streak';
import { useAppStore } from '@/lib/store/useAppStore';
import { plural } from '@/lib/ui/catalog';

export default function HomePage() {
  const router = useRouter();
  const state = useAppStore((s) => s.state);
  const recentDeeds = useAppStore((s) => s.recentDeeds);
  const storageKind = useAppStore((s) => s.storageKind);

  const nativeButton = useMainButton({
    text: 'Добавить дело',
    onClick: () => router.push('/add'),
  });

  // Уровень производный от кармы — считаем на месте, а не храним на диске.
  const level = levelForXp(state.totalKarma);
  const progress = levelProgress(state.totalKarma);
  const toNext = minXpForLevel(level + 1) - state.totalKarma;
  const streak = currentStreakOn(state.streak, toDateKey(new Date()));
  const bump = useKarmaBump(state.totalKarma);

  return (
    <main className="page">
      {storageKind === 'local' && (
        <div className="banner">
          <span>⚠️</span>
          <span>
            Telegram CloudStorage недоступен — данные хранятся только на этом устройстве
            и не синхронизируются.
          </span>
        </div>
      )}

      <Greeting />

      <section className="card">
        <div className="hint">Всего кармы</div>
        <div className={`karma-total${bump ? ' bump' : ''}`}>{state.totalKarma}</div>
        <div className="row" style={{ marginTop: 16, marginBottom: 8 }}>
          <span className="level-title">
            Ур. {level} · {levelTitle(level)}
          </span>
          <span className="spacer" />
          <span className="hint">до {level + 1}: {toNext}</span>
        </div>
        <div className="progress">
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </section>

      <div className="stats">
        <div className="stat">
          <b>🔥 {streak}</b>
          <span>{plural(streak, 'день', 'дня', 'дней')} подряд</span>
        </div>
        <div className="stat">
          <b>{state.deedCount}</b>
          <span>{plural(state.deedCount, 'дело', 'дела', 'дел')}</span>
        </div>
        <div className="stat">
          <b>{state.badges.length}</b>
          <span>{plural(state.badges.length, 'бейдж', 'бейджа', 'бейджей')}</span>
        </div>
      </div>

      {!nativeButton && (
        <Link href="/add" className="btn">
          Добавить дело
        </Link>
      )}

      <section>
        <div className="row" style={{ marginBottom: 8, padding: '0 4px' }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            Последние дела
          </h2>
          <span className="spacer" />
          <Link href="/history" style={{ fontSize: 13 }}>
            Вся история
          </Link>
        </div>
        <DeedList deeds={recentDeeds} />
      </section>

      <Link href="/profile" className="btn secondary">
        Профиль и бейджи
      </Link>
    </main>
  );
}

function Greeting() {
  const [name, setName] = useState<string | null>(null);

  // initData читаем только ради имени: валидировать нечем и незачем —
  // сервера в V1 нет. HMAC появится в V2 вместе с бэкендом.
  useEffect(() => {
    try {
      setName(initDataUser()?.first_name ?? null);
    } catch {
      setName(null);
    }
  }, []);

  if (!name) return null;
  return <div className="hint" style={{ padding: '0 4px' }}>Привет, {name} 👋</div>;
}

/** Короткая анимация числа кармы, когда оно выросло с прошлого рендера. */
function useKarmaBump(total: number): boolean {
  const [bump, setBump] = useState(false);
  const previous = useRef(total);

  useEffect(() => {
    if (total > previous.current) {
      setBump(true);
      const timer = setTimeout(() => setBump(false), 560);
      previous.current = total;
      return () => clearTimeout(timer);
    }
    previous.current = total;
  }, [total]);

  return bump;
}
