'use client';

import { useCallback, useEffect, useState } from 'react';

import type { DeedView, SlotView } from '@/lib/api/types';
import { useAppStore } from '@/lib/store/useAppStore';
import { hapticImpact } from '@/lib/telegram/haptics';
import { shareLink } from '@/lib/telegram/share';

/**
 * Ссылки на ревью — то, ради чего существует V2.
 *
 * Сколько их — решает сервер (`REVIEWER_SLOTS`), поэтому подписи считаются от
 * длины пришедшего списка, а не зашиты во множественном числе.
 *
 * Ссылки не создаются вместе с делом: живой токен переиспользуется, мёртвый
 * заменяется. Поэтому компонент дёргает `send-review` только когда слоту
 * действительно нужна ссылка, и берёт состояние из store — оно обновляется
 * из ответа сервера, а не из локальных догадок.
 */
export function ShareReviewLinks({ deed: initial }: { deed: DeedView }) {
  const requestReviewLinks = useAppStore((s) => s.requestReviewLinks);
  const fromStore = useAppStore((s) => s.deeds.find((d) => d.id === initial.id));
  const deed = fromStore ?? initial;

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const needsLinks = deed.slots.some((slot) => slot.state === 'none' || slot.state === 'expired');
  const many = deed.slots.length > 1;

  const ensureLinks = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      await requestReviewLinks(deed.id);
    } catch (error) {
      console.error('[share] send-review failed', error);
      setNote('Не удалось получить ссылки. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }, [deed.id, requestReviewLinks]);

  // Только что записанное дело приходит совсем без ссылок — просить их
  // отдельным тапом было бы лишним шагом ровно там, где человек уже готов делиться.
  useEffect(() => {
    if (deed.slots.every((slot) => slot.state === 'none')) void ensureLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function share(slot: SlotView) {
    if (!slot.url) return;
    hapticImpact('light');
    const outcome = await shareLink(
      slot.url,
      `Оцени, пожалуйста, моё доброе дело: «${deed.description || 'без описания'}»`,
    );
    setNote(
      outcome === 'copied'
        ? 'Ссылка скопирована — отправьте её любым способом'
        : outcome === 'failed'
          ? 'Не удалось поделиться. Скопируйте ссылку вручную.'
          : null,
    );
  }

  return (
    <section>
      <h2 className="section-title">{many ? 'Рецензенты' : 'Рецензент'}</h2>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {deed.slots.map((slot) => (
          <div className="slot" key={slot.slot}>
            <div className="row">
              <b>{many ? `Рецензент ${slot.slot}` : 'Рецензент'}</b>
              <span className="spacer" />
              <span className={`pill ${slot.state === 'reviewed' ? 'done' : slot.state === 'waiting' ? 'wait' : 'muted'}`}>
                {SLOT_LABEL[slot.state]}
              </span>
            </div>

            {slot.state === 'reviewed' && (
              <div className="hint" style={{ marginTop: 6 }}>
                Оценка: {slot.score}
                {slot.comment ? ` · «${slot.comment}»` : ''}
              </div>
            )}

            {slot.state === 'waiting' && slot.url && (
              <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => share(slot)}>
                Отправить ссылку
              </button>
            )}

            {(slot.state === 'none' || slot.state === 'expired') && (
              <div className="hint" style={{ marginTop: 6 }}>
                {slot.state === 'expired'
                  ? 'Ссылка прожила 72 часа и больше не работает.'
                  : 'Ссылка ещё не создана.'}
              </div>
            )}
          </div>
        ))}

        {needsLinks && (
          <button className="btn" disabled={busy} onClick={() => void ensureLinks()}>
            {busy
              ? many
                ? 'Готовим ссылки…'
                : 'Готовим ссылку…'
              : many
                ? 'Создать ссылки заново'
                : 'Создать ссылку заново'}
          </button>
        )}

        {note && <div className="hint">{note}</div>}
      </div>
    </section>
  );
}

const SLOT_LABEL: Record<SlotView['state'], string> = {
  none: 'нет ссылки',
  waiting: 'ждём оценку',
  expired: 'ссылка истекла',
  reviewed: 'оценил',
};
