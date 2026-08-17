'use client';

import { useEffect } from 'react';

import { levelTitle } from '@/lib/karma/scoring';
import { badgeDefinition } from '@/lib/karma/badges';
import type { Badge } from '@/lib/karma/types';

interface Props {
  level: number;
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
        <h2>Уровень {level}</h2>
        <div className="hint">{levelTitle(level)}</div>
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
