'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { ReviewScale } from '@/components/ReviewScale';
import { ApiError, api } from '@/lib/api/client';
import type { ReviewPageResponse } from '@/lib/api/types';
import { REVIEW_COMMENT_MAX_LENGTH } from '@/lib/karma/review';
import { hapticImpact } from '@/lib/telegram/haptics';
import { CATEGORY_META } from '@/lib/ui/catalog';

/**
 * Экран рецензента: сюда приводит ссылка `?startapp=r<token>`.
 *
 * Раньше это была отдельная страница без логина в любом браузере. Из-за этого
 * сервер не знал, кто ставит балл, и автор мог подтвердить собственное дело —
 * поэтому оценка переехала внутрь Mini App, где рецензент опознан.
 */

/** Почему ссылка не открылась — человеку, а не кодом. */
const PROBLEM: Record<string, { emoji: string; text: string }> = {
  cannot_review_own_deed: {
    emoji: '🙃',
    text: 'Это ваше собственное дело. Его проверяет кто-то другой — перешлите ссылку.',
  },
  already_reviewed_by_you: {
    emoji: '✅',
    text: 'Вы уже проверили это дело. Второй раз нельзя — в этом весь смысл проверки.',
  },
  link_used: { emoji: '✅', text: 'По этой ссылке уже проверили.' },
  link_expired: { emoji: '⌛', text: 'Ссылка прожила свой срок. Попросите автора выслать новую.' },
  link_revoked: { emoji: '🔗', text: 'Ссылка больше не действует — автор выпустил новую.' },
  deed_already_approved: { emoji: '🎉', text: 'Дело уже подтверждено. Спасибо!' },
  link_invalid: { emoji: '🤔', text: 'Такой ссылки не существует.' },
};

export default function RatePage() {
  const [token, setToken] = useState<string | null>(null);
  const [page, setPage] = useState<ReviewPageResponse | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ approved: boolean; finalScore: number | null } | null>(null);

  // Токен приходит из deep-link; AppShell кладёт его в адрес, чтобы экран
  // пережил перезагрузку и работал в браузере при разработке.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('t');
    setToken(fromUrl);
  }, []);

  const load = useCallback(async (value: string) => {
    try {
      const data = await api.reviewPage(value);
      setPage(data);
      // Ручка стартует с системной подсказки: рецензенту есть от чего
      // оттолкнуться, но значение он всё равно ставит сам.
      setScore(data.deed.baseScore);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.code : 'link_invalid');
    }
  }, []);

  useEffect(() => {
    if (token) void load(token);
  }, [token, load]);

  async function submit() {
    if (!token || sending) return;
    setSending(true);
    hapticImpact('medium');
    try {
      const result = await api.submitReview(token, {
        score,
        comment: comment.trim() || undefined,
      });
      setDone({ approved: result.status === 'approved', finalScore: result.finalScore });
    } catch (error) {
      setProblem(error instanceof ApiError ? error.code : 'link_invalid');
    } finally {
      setSending(false);
    }
  }

  if (problem) {
    const view = PROBLEM[problem] ?? {
      emoji: '😕',
      text: 'Не удалось открыть проверку. Попробуйте позже.',
    };
    return (
      <main className="page">
        <div className="empty">
          <span className="emoji">{view.emoji}</span>
          {view.text}
        </div>
        <Link href="/" className="btn secondary">
          На главную
        </Link>
      </main>
    );
  }

  if (done) {
    return (
      <main className="page">
        <div className="empty">
          <span className="emoji">🙏</span>
          Спасибо за проверку!
          {done.approved && done.finalScore !== null && (
            <p>Дело подтверждено на {done.finalScore} кармы.</p>
          )}
        </div>
        <Link href="/add" className="btn">
          Записать своё дело
        </Link>
      </main>
    );
  }

  if (!token || !page) {
    return (
      <main className="page">
        <div className="empty">
          <span className="emoji">🌱</span>
          Открываем дело…
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="card">
        <div className="hint">
          {page.author.firstName ?? 'Кто-то'} просит проверить доброе дело
        </div>
        <p style={{ fontSize: 18, margin: '10px 0 12px' }}>{page.deed.description}</p>
        <div className="hint">
          {CATEGORY_META[page.deed.category].icon} {CATEGORY_META[page.deed.category].label}
        </div>
      </section>

      <section className="card">
        <ReviewScale
          value={score}
          max={page.maxScore}
          anchors={page.anchors}
          baseScore={page.deed.baseScore}
          onChange={setScore}
        />
      </section>

      <label className="card" style={{ display: 'block' }}>
        <span className="hint">Комментарий — по желанию</span>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={REVIEW_COMMENT_MAX_LENGTH}
          rows={3}
          placeholder="Пара слов автору"
          style={{ width: '100%', marginTop: 8 }}
        />
      </label>

      <button className="btn" disabled={sending} onClick={() => void submit()}>
        {sending ? 'Отправляем…' : `Поставить ${score}`}
      </button>
    </main>
  );
}
