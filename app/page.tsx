'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { DeedList } from '@/components/DeedList';
import { LevelUpOverlay } from '@/components/LevelUpOverlay';
import { useMainButton } from '@/components/useMainButton';
import { useAppStore } from '@/lib/store/useAppStore';
import { plural } from '@/lib/ui/catalog';

const RECENT_LIMIT = 5;

export default function HomePage() {
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  const counts = useAppStore((s) => s.counts);
  const deeds = useAppStore((s) => s.deeds);
  const legacyImport = useAppStore((s) => s.legacyImport);
  const celebration = useAppStore((s) => s.celebration);
  const dismissCelebration = useAppStore((s) => s.dismissCelebration);

  const nativeButton = useMainButton({
    text: 'Добавить дело',
    onClick: () => router.push('/add'),
  });

  const bump = useKarmaBump(profile?.karmaTotal ?? 0);
  if (!profile) return null;

  const progress =
    profile.currentLevelXp + profile.xpToNextLevel > 0
      ? profile.currentLevelXp / (profile.currentLevelXp + profile.xpToNextLevel)
      : 0;

  return (
    <main className="page">
      {legacyImport.status === 'done' && legacyImport.imported > 0 && (
        <div className="banner info">
          <span>📦</span>
          <span>
            Перенесли {legacyImport.imported}{' '}
            {plural(legacyImport.imported, 'дело', 'дела', 'дел')} из прежней версии. Они попали
            в самооценку — в общий рейтинг идёт только подтверждённая карма.
          </span>
        </div>
      )}

      {profile.firstName && (
        <div className="hint" style={{ padding: '0 4px' }}>
          Привет, {profile.firstName} 👋
        </div>
      )}

      <section className="card">
        <div className="hint">Подтверждённая карма</div>
        <div className={`karma-total${bump ? ' bump' : ''}`}>{profile.karmaTotal}</div>

        {profile.karmaSelfTotal > 0 && (
          <div className="hint" style={{ marginTop: 4 }}>
            Самооценка из прежней версии: {profile.karmaSelfTotal}
          </div>
        )}

        <div className="row" style={{ marginTop: 16, marginBottom: 8 }}>
          <span className="level-title">
            Ур. {profile.level} · {profile.levelTitle}
          </span>
          <span className="spacer" />
          <span className="hint">
            до {profile.level + 1}: {profile.xpToNextLevel}
          </span>
        </div>
        <div className="progress">
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </section>

      <div className="stats">
        <div className="stat">
          <b>🔥 {profile.streak}</b>
          <span>{plural(profile.streak, 'день', 'дня', 'дней')} подряд</span>
        </div>
        <div className="stat">
          <b>{profile.deedCount}</b>
          <span>{plural(profile.deedCount, 'дело', 'дела', 'дел')}</span>
        </div>
        <div className="stat">
          <b>{profile.badges.length}</b>
          <span>{plural(profile.badges.length, 'бейдж', 'бейджа', 'бейджей')}</span>
        </div>
      </div>

      {/* Главное новое состояние V2: дела, которые ждут чужой оценки. */}
      <Link href="/review" className="card row" style={{ textDecoration: 'none' }}>
        <span className="icon-badge">⏳</span>
        <span className="body">
          <b style={{ display: 'block' }}>На ревью</b>
          <span className="hint">
            {counts.pending === 0
              ? 'Все дела проверены'
              : `${counts.pending} ${plural(counts.pending, 'дело ждёт', 'дела ждут', 'дел ждут')} оценки`}
          </span>
        </span>
        <span className="spacer" />
        <span className="hint">›</span>
      </Link>

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
        <DeedList deeds={deeds.slice(0, RECENT_LIMIT)} />
      </section>

      <Link href="/leaderboard" className="btn secondary">
        Лидерборд
      </Link>
      <Link href="/profile" className="btn secondary">
        Профиль и бейджи
      </Link>

      {celebration && (
        <LevelUpOverlay
          level={celebration.level}
          badges={celebration.badges}
          onDismiss={dismissCelebration}
        />
      )}
    </main>
  );
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
