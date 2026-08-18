'use client';

import { useEffect } from 'react';

import { levelTitle } from '@/lib/karma/scoring';
import { badgeDefinition } from '@/lib/karma/badges';
import type { Badge } from '@/lib/karma/types';

interface Props {
  /** null — праздновать нечего кроме бейджей: карма выросла, но уровень тот же */
  level: number | null;
  badges: Badge[];
  onDismiss(): void;
}

/** Level-up: полноэкранная пауза на пару секунд — главный момент геймификации. */
export function LevelUpOverlay({ level, badges, onDismiss }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 2600);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="levelup" onClick={onDismiss} role="presentation">
      <div className="inner">
        <div className="ring">🎉</div>
        <h2>{level === null ? 'Новый бейдж' : `Уровень ${level}`}</h2>
        <div className="hint">
          {level === null ? 'Дело подтвердили проверяющие' : levelTitle(level)}
        </div>
        {badges.length > 0 && (
          <div className="badge-grid" style={{ marginTop: 20 }}>
            {badges.map((badge) => {
              const def = badgeDefinition(badge.code);
              if (!def) return null;
              return (
                <div className="badge" key={badge.code}>
                  <div className="emoji">{def.icon}</div>
                  <b>{def.title}</b>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
