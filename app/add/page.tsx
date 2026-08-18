'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { ShareReviewLinks } from '@/components/ShareReviewLinks';
import { useMainButton } from '@/components/useMainButton';
import type { DeedView } from '@/lib/api/types';
import { badgeDefinition } from '@/lib/karma/badges';
import {
  DEED_CATEGORIES,
  DESCRIPTION_MAX_LENGTH,
  EFFORT_LEVELS,
  computeKarmaPoints,
} from '@/lib/karma/scoring';
import type { DeedCategory, EffortLevel } from '@/lib/karma/types';
import { useAppStore } from '@/lib/store/useAppStore';
import { hapticImpact, hapticSelection, hapticSuccess } from '@/lib/telegram/haptics';
import { REVIEWER_SLOTS } from '@/lib/karma/review';
import { CATEGORY_META, EFFORT_META } from '@/lib/ui/catalog';

export default function AddDeedPage() {
  const router = useRouter();
  const addDeed = useAppStore((s) => s.addDeed);

  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<DeedCategory | null>(null);
  const [effortLevel, setEffortLevel] = useState<EffortLevel>(1);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Дело записано — экран переключается на второй шаг: разослать ссылки.
  const [created, setCreated] = useState<DeedView | null>(null);

  const points = category ? computeKarmaPoints(category, effortLevel) : 0;

  const submit = useCallback(async () => {
    if (!category || saving) return;
    setSaving(true);
    try {
      const outcome = await addDeed({ description, category, effortLevel });
      hapticImpact('medium');

      if (outcome.newBadges.length > 0) {
        hapticSuccess();
        const def = badgeDefinition(outcome.newBadges[0].code);
        if (def) setToast(`${def.icon} ${def.title}`);
        setTimeout(() => setToast(null), 2400);
      }

      setCreated(outcome.deed);
    } catch (error) {
      console.error('[add] failed', error);
      setToast('Не удалось записать дело');
      setTimeout(() => setToast(null), 2400);
    } finally {
      setSaving(false);
    }
  }, [addDeed, category, description, effortLevel, saving]);

  const nativeButton = useMainButton({
    text: created ? 'Готово' : category ? `Записать дело · ~${points}` : 'Выберите категорию',
    onClick: created ? () => router.replace('/') : submit,
    enabled: Boolean(category) || Boolean(created),
    loading: saving,
  });

  if (created) {
    return (
      <main className="page">
        <h1 className="karma-total" style={{ fontSize: 24 }}>
          Дело записано
        </h1>
        {/*
          Текст дважды устаревал: обещал двух проверяющих, когда остался один,
          и «браузер без регистрации», хотя проверка переехала внутрь Mini App
          и Telegram теперь как раз нужен. Число берётся из REVIEWER_SLOTS,
          чтобы не разъезжаться снова.
        */}
        <p className="hint" style={{ padding: '0 4px', marginTop: -8 }}>
          {REVIEWER_SLOTS.length === 1
            ? 'Карма придёт, когда дело проверит кто-то другой.'
            : `Карма придёт, когда дело проверят ${REVIEWER_SLOTS.length} человека.`}{' '}
          {REVIEWER_SLOTS.length === 1 ? 'Отправьте ссылку' : 'Отправьте им ссылки'} — она
          откроется в Telegram. Своё дело проверить нельзя.
        </p>

        <ShareReviewLinks deed={created} />

        {!nativeButton && (
          <button className="btn secondary" onClick={() => router.replace('/')}>
            Готово
          </button>
        )}

        {toast && <div className="toast">{toast}</div>}
      </main>
    );
  }

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
          {description.length}/{DESCRIPTION_MAX_LENGTH} · это увидят проверяющие
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

      {/* «~» вместо «+»: это предложение системы проверяющим, а не начисление. */}
      <div className="preview">
        <b>~{points}</b>
        <span className="hint">предложим проверяющим</span>
      </div>

      {!nativeButton && (
        <button className="btn" disabled={!category || saving} onClick={submit}>
          {saving ? 'Записываем…' : 'Записать дело'}
        </button>
      )}

      {toast && <div className="toast">{toast}</div>}

      {saving && (
        <div className="saving" role="status" aria-live="polite">
          <div className="spinner" />
          <span>Записываем дело…</span>
        </div>
      )}
    </main>
  );
}
