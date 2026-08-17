'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { LeaderboardEntry } from '@/lib/api/types';
import { useAppStore } from '@/lib/store/useAppStore';
import { hapticImpact } from '@/lib/telegram/haptics';
import { shareInvite } from '@/lib/telegram/share';

type Tab = 'friends' | 'global';

/**
 * Лидерборды. Считается ТОЛЬКО подтверждённая карма — самооценка из V1 сюда
 * не попадает, иначе рейтинг мерил бы не добрые дела, а честность.
 */
export default function LeaderboardPage() {
  const friends = useAppStore((s) => s.friends);
  const global = useAppStore((s) => s.global);
  const meRank = useAppStore((s) => s.globalMeRank);
  const inviteLink = useAppStore((s) => s.inviteLink);
  const loadLeaderboards = useAppStore((s) => s.loadLeaderboards);

  const [tab, setTab] = useState<Tab>('friends');
  const [error, setError] = useState(false);

  useEffect(() => {
    loadLeaderboards().catch((cause) => {
      console.error('[leaderboard] failed', cause);
      setError(true);
    });
  }, [loadLeaderboards]);

  const entries = tab === 'friends' ? friends : global;

  return (
    <main className="page">
      <h1 className="karma-total" style={{ fontSize: 24 }}>
        Лидерборд
      </h1>

      <div className="filters">
        <button
          type="button"
          className="filter"
          aria-pressed={tab === 'friends'}
          onClick={() => setTab('friends')}
        >
          Друзья
        </button>
        <button
          type="button"
          className="filter"
          aria-pressed={tab === 'global'}
          onClick={() => setTab('global')}
        >
          Глобальный
        </button>
      </div>

      {error && (
        <div className="banner">
          <span>⚠️</span>
          <span>Не удалось загрузить рейтинг. Попробуйте позже.</span>
        </div>
      )}

      {entries === null && !error && <div className="empty">Загружаем рейтинг…</div>}

      {/* В рейтинге друзей всегда есть минимум одна строка — своя. Показывать
          её одну бессмысленно: это не рейтинг, а приглашение позвать друзей. */}
      {entries !== null && tab === 'friends' && entries.length <= 1 ? (
        <div className="empty">
          <span className="emoji">👋</span>
          Друзей пока нет. Пригласите — сравнивать карму вдвоём интереснее.
        </div>
      ) : (
        entries !== null && entries.length > 0 && <Board entries={entries} />
      )}

      {tab === 'global' && meRank !== null && (
        <div className="hint" style={{ textAlign: 'center' }}>
          Ваше место в мире: {meRank}
        </div>
      )}

      {inviteLink && (
        <button
          className="btn"
          onClick={() => {
            hapticImpact('light');
            void shareInvite(inviteLink);
          }}
        >
          Пригласить друга
        </button>
      )}
    </main>
  );
}

function Board({ entries }: { entries: LeaderboardEntry[] }) {
  const router = useRouter();

  return (
    <div className="deed-list">
      {entries.map((entry) => (
        <button
          type="button"
          className={`rank-row${entry.isMe ? ' me' : ''}`}
          key={entry.id}
          onClick={() => !entry.isMe && router.push(`/friend/?id=${entry.id}`)}
        >
          <span className="rank">{entry.rank}</span>
          <Avatar entry={entry} />
          <span className="body">
            <b>{entry.firstName ?? entry.username ?? 'Без имени'}</b>
            <span>
              Ур. {entry.level} · {entry.levelTitle}
            </span>
          </span>
          <span className="points">{entry.karmaTotal}</span>
        </button>
      ))}
    </div>
  );
}

function Avatar({ entry }: { entry: LeaderboardEntry }) {
  const letter = (entry.firstName ?? entry.username ?? '?').trim().charAt(0).toUpperCase();
  if (!entry.photoUrl) return <span className="avatar">{letter}</span>;
  // Аватар приходит с серверов Telegram; next/image здесь только помешал бы
  // (статический экспорт, внешний домен).
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="avatar" src={entry.photoUrl} alt="" />;
}
