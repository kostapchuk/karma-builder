'use client';

import { BADGES } from '@/lib/karma/badges';
import { DEED_CATEGORIES, levelTitle, minXpForLevel } from '@/lib/karma/scoring';
import { useAppStore } from '@/lib/store/useAppStore';
import { hapticImpact } from '@/lib/telegram/haptics';
import { shareInvite } from '@/lib/telegram/share';
import { CATEGORY_META, plural } from '@/lib/ui/catalog';


const LEVELS_SHOWN = 10;

export default function ProfilePage() {
  const profile = useAppStore((s) => s.profile);
  const counts = useAppStore((s) => s.counts);
  const inviteLink = useAppStore((s) => s.inviteLink);
  const referrals = useAppStore((s) => s.referrals);

  if (!profile) return null;

  const earned = new Map(profile.badges.map((b) => [b.code, b] as const));
  const maxCategoryCount = Math.max(1, ...profile.categoryCounts);

  return (
    <main className="page">
      <h1 className="karma-total" style={{ fontSize: 24 }}>
        Профиль
      </h1>

      {/*
        Шкала одна: карма существует только подтверждённой. Записанное, но не
        оценённое дело баллов не даёт — в этом весь V2.
      */}
      <section className="card">
        <div className="hint">Подтверждённая карма</div>
        <div className="karma-total" style={{ fontSize: 34 }}>
          {profile.karmaTotal}
        </div>
        <div className="hint" style={{ marginTop: 10 }}>
          Баллы начисляет не автор: их ставит тот, кому вы отправили ссылку.
        </div>
      </section>

      <div className="stats">
        <div className="stat">
          <b>🔥 {profile.streak}</b>
          <span>текущий стрик</span>
        </div>
        <div className="stat">
          <b>🏅 {profile.longestStreak}</b>
          <span>рекорд</span>
        </div>
        <div className="stat">
          <b>⏳ {counts.pending}</b>
          <span>на проверке</span>
        </div>
      </div>

      <section>
        <h2 className="section-title">
          Бейджи · {profile.badges.length} из {BADGES.length}
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
          {profile.deedCount === 0 ? (
            <div className="hint">Пока нет данных</div>
          ) : (
            DEED_CATEGORIES.map((code, i) => {
              const count = profile.categoryCounts[i] ?? 0;
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
            const reached = profile.level >= n;
            return (
              <div
                className={`level-row${profile.level === n ? ' current' : ''}${reached ? '' : ' locked'}`}
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
        {profile.level > LEVELS_SHOWN && (
          <div className="hint" style={{ padding: '8px 4px 0' }}>
            Текущий: ур. {profile.level} · {profile.levelTitle}
          </div>
        )}
      </section>

      <section>
        <h2 className="section-title">Дела</h2>
        <div className="card">
          <div className="hint">
            {profile.deedCount} {plural(profile.deedCount, 'дело', 'дела', 'дел')} всего ·{' '}
            {counts.approved} подтверждено · {counts.pending} на проверке
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            Дела хранятся на сервере и доступны со всех ваших устройств.
          </div>
          {referrals.invited > 0 && (
            <div className="hint" style={{ marginTop: 6 }}>
              Приглашено {referrals.invited}, из них {referrals.active} довели дело до
              подтверждения · принесли {referrals.karma}{' '}
              {plural(referrals.karma, 'карму', 'кармы', 'кармы')}
            </div>
          )}
        </div>
      </section>

      {inviteLink && (
        <button
          className="btn secondary"
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
