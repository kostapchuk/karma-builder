'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { LevelUpOverlay } from '@/components/LevelUpOverlay';
import { useMainButton } from '@/components/useMainButton';
import { badgeDefinition } from '@/lib/karma/badges';
import {
  DEED_CATEGORIES,
  DESCRIPTION_MAX_LENGTH,
  EFFORT_LEVELS,
  computeKarmaPoints,
} from '@/lib/karma/scoring';
import type { Badge, DeedCategory, EffortLevel } from '@/lib/karma/types';
import { useAppStore } from '@/lib/store/useAppStore';
import { hapticImpact, hapticSelection, hapticSuccess } from '@/lib/telegram/haptics';
import { CATEGORY_META, EFFORT_META } from '@/lib/ui/catalog';

export default function AddDeedPage() {
  const router = useRouter();
  const addDeed = useAppStore((s) => s.addDeed);

  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<DeedCategory | null>(null);
  const [effortLevel, setEffortLevel] = useState<EffortLevel>(1);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [levelUp, setLevelUp] = useState<{ level: number; badges: Badge[] } | null>(null);

  const points = category ? computeKarmaPoints(category, effortLevel) : 0;

  const submit = useCallback(async () => {
    if (!category || saving) return;
    setSaving(true);
    try {
      const outcome = await addDeed({ description, category, effortLevel });

      setToast(`+${outcome.deed.karmaPoints} кармы`);
      hapticImpact('medium');

      if (outcome.leveledUp) {
        // Level-up — самый заметный момент, поэтому и оверлей, и success-haptic.
        hapticSuccess();
        setLevelUp({ level: outcome.newLevel, badges: outcome.newBadges });
        return;
      }

      if (outcome.newBadges.length > 0) {
        hapticSuccess();
        const def = badgeDefinition(outcome.newBadges[0].code);
        if (def) setToast(`${def.icon} ${def.title}`);
      }

      setTimeout(() => router.replace('/'), 900);
    } catch (error) {
      console.error('[add] failed', error);
      setSaving(false);
      setToast('Не удалось сохранить дело');
      setTimeout(() => setToast(null), 2200);
    }
  }, [addDeed, category, description, effortLevel, router, saving]);

  const nativeButton = useMainButton({
    text: category ? `Записать дело · +${points}` : 'Выберите категорию',
    onClick: submit,
    enabled: Boolean(category) && !saving,
  });

  return (
    <main className="page">
      <h1 className="karma-total" style={{ fontSize: 24 }}>
        Новое дело
      </h1>

      <div>
        <h2 className="section-title">Что вы сделали</h2>
        <textarea
          className="textarea"
          value={description}
          maxLength={DESCRIPTION_MAX_LENGTH}
          placeholder="Помог соседке донести сумки…"
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="hint" style={{ textAlign: 'right', marginTop: 4 }}>
          {description.length}/{DESCRIPTION_MAX_LENGTH} · на баллы не влияет
        </div>
      </div>

      <div>
        <h2 className="section-title">Категория</h2>
        <div className="chip-grid">
          {DEED_CATEGORIES.map((code) => {
            const meta = CATEGORY_META[code];
            return (
              <button
                key={code}
                type="button"
                className="chip"
                aria-pressed={category === code}
                onClick={() => {
                  setCategory(code);
                  hapticSelection();
                }}
              >
                <span className="chip-icon">{meta.icon}</span>
                <span>{meta.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="section-title">Усилие</h2>
        <div className="effort-grid">
          {EFFORT_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className="effort"
              aria-pressed={effortLevel === level}
              onClick={() => {
                setEffortLevel(level);
                hapticSelection();
              }}
            >
              <b>{EFFORT_META[level].label}</b>
              <span>{EFFORT_META[level].hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="preview">
        <b>+{points}</b>
        <span className="hint">кармы за это дело</span>
      </div>

      {!nativeButton && (
        <button className="btn" disabled={!category || saving} onClick={submit}>
          {saving ? 'Сохраняем…' : 'Записать дело'}
        </button>
      )}

      {toast && <div className="toast">{toast}</div>}

      {levelUp && (
        <LevelUpOverlay
          level={levelUp.level}
          badges={levelUp.badges}
          onDismiss={() => router.replace('/')}
        />
      )}
    </main>
  );
}
