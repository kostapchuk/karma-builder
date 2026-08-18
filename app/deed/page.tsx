'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { STATUS_META } from '@/components/DeedList';
import { ShareReviewLinks } from '@/components/ShareReviewLinks';
import { ApiError, api } from '@/lib/api/client';
import type { DeedView } from '@/lib/api/types';
import { sqlToEpoch } from '@/lib/api/types';
import { useAppStore } from '@/lib/store/useAppStore';
import { CATEGORY_META, EFFORT_META, formatDeedTime } from '@/lib/ui/catalog';

/**
 * Одно дело целиком.
 *
 * Список показывает только название, статус и баллы — три яруса мелкого текста
 * в строке мешали читать главное. Всё остальное живёт здесь: категория, усилие,
 * время, ссылка на проверку и балл с комментарием проверяющего.
 */
export default function DeedPage() {
  const [id, setId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<DeedView | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Дело из уже загруженной истории; если его там нет — тянем по id.
  const fromStore = useAppStore((s) => s.deeds.find((d) => d.id === id));
  const deed = fromStore ?? loaded;

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get('id'));
  }, []);

  const fetchDeed = useCallback(async (value: string) => {
    try {
      const result = await api.deed(value);
      setLoaded(result.deed);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 404 ? 'not_found' : 'failed');
    }
  }, []);

  useEffect(() => {
    if (id && !fromStore) void fetchDeed(id);
  }, [id, fromStore, fetchDeed]);

  if (error) {
    return (
      <main className="page">
        <div className="empty">
          <span className="emoji">{error === 'not_found' ? '🤔' : '😕'}</span>
          {error === 'not_found' ? 'Такого дела нет.' : 'Не удалось открыть дело.'}
        </div>
        <Link href="/history/" className="btn secondary">
          Вся история
        </Link>
      </main>
    );
  }

  if (!deed) {
    return (
      <main className="page">
        <div className="empty">
          <span className="emoji">🌱</span>
          Открываем дело…
        </div>
      </main>
    );
  }

  const meta = CATEGORY_META[deed.category];
  const status = STATUS_META[deed.status];
  const approved = deed.status === 'approved';
  const waiting = deed.status === 'pending' || deed.status === 'partially_reviewed';
  const reviewed = deed.slots.filter((slot) => slot.state === 'reviewed');

  return (
    <main className="page">
      <section className="card">
        <div className="row">
          <span className="icon-badge">{meta.icon}</span>
          <span className="body">
            <b style={{ display: 'block', fontSize: 17 }}>{deed.description || meta.label}</b>
            <span className={`pill ${status.tone}`}>{status.label}</span>
          </span>
          <span className="spacer" />
          <span className={`points${approved ? '' : ' muted'}`}>
            {approved ? `+${deed.finalScore}` : `~${deed.baseScore}`}
          </span>
        </div>

        <div className="hint" style={{ marginTop: 12 }}>
          {meta.label} · {EFFORT_META[deed.effortLevel].label} ·{' '}
          {formatDeedTime(sqlToEpoch(deed.createdAt))}
        </div>

        {!approved && (
          // «~» — предложение системы, а не начисление: карму ставит проверяющий.
          <div className="hint" style={{ marginTop: 6 }}>
            Система предложит проверяющему {deed.baseScore}; итоговый балл — за ним.
          </div>
        )}
      </section>

      {reviewed.length > 0 && (
        <section className="card">
          <div className="section-title" style={{ margin: '0 0 8px' }}>
            Проверка
          </div>
          {reviewed.map((slot) => (
            <div key={slot.slot} className="hint">
              Балл: {slot.score}
              {slot.comment ? ` · «${slot.comment}»` : ''}
            </div>
          ))}
        </section>
      )}

      {waiting && <ShareReviewLinks deed={deed} />}

      <Link href="/history/" className="btn secondary">
        Вся история
      </Link>
    </main>
  );
}
