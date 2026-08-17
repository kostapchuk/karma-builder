/**
 * Одна страница, одна задача: посторонний человек ставит одну оценку.
 *
 * Ни логина, ни регистрации, ни навигации — всё, что есть, это дело, шкала
 * и кнопка. Всё остальное на этой странице было бы лишним.
 */

import { useEffect, useState } from 'react';

import { CATEGORY_META, EFFORT_META, formatDeedTime } from '../../lib/ui/catalog';
import { REVIEW_COMMENT_MAX_LENGTH } from '../../lib/karma/review';
import type { DeedCategory, EffortLevel } from '../../lib/karma/types';
import { ApiError, fetchReviewPage, submitReview, type ReviewPage, type SubmitResult } from './api';
import { Scale } from './Scale';

/** Единственный маршрут приложения. */
function tokenFromLocation(): string | null {
  const match = /^\/r\/([A-Za-z0-9_-]{8,64})\/?$/.exec(window.location.pathname);
  return match ? match[1] : null;
}

const sqlToEpoch = (value: string) => Date.parse(`${value.replace(' ', 'T')}Z`) / 1000;

/** Отказы объясняем по-человечески: рецензент не знает и не должен знать наших кодов. */
const FAILURES: Record<string, { title: string; body: string }> = {
  link_invalid: {
    title: 'Ссылка не найдена',
    body: 'Возможно, в адресе опечатка. Попросите отправить ссылку ещё раз.',
  },
  link_used: {
    title: 'По этой ссылке уже оценили',
    body: 'Каждая ссылка работает один раз — так дело не оценят дважды.',
  },
  link_expired: {
    title: 'Срок ссылки истёк',
    body: 'Ссылка живёт 72 часа. Попросите автора прислать новую — это одна кнопка.',
  },
  link_revoked: {
    title: 'Ссылка больше не действует',
    body: 'Автор выпустил вместо неё новую. Попросите свежую ссылку.',
  },
  deed_already_approved: {
    title: 'Дело уже оценено',
    body: 'Двое рецензентов успели раньше. Спасибо, что открыли!',
  },
  network: {
    title: 'Нет связи с сервером',
    body: 'Проверьте интернет и обновите страницу.',
  },
  unknown: {
    title: 'Что-то пошло не так',
    body: 'Обновите страницу. Если не помогло — попросите новую ссылку.',
  },
};

function Failure({ code }: { code: string }) {
  const { title, body } = FAILURES[code] ?? FAILURES.unknown;
  // Крупного показания здесь нет намеренно: оценивать нечего, и цифра
  // на пустом экране только сбивала бы с толку.
  return (
    <main className="page final">
      <p className="eyebrow">Karma Builder</p>
      <h1>{title}</h1>
      <p>{body}</p>
    </main>
  );
}

function Thanks({ result }: { result: SubmitResult }) {
  const approved = result.status === 'approved';
  return (
    <main className="page final">
      {/* Показание прибора: либо итоговый балл, либо «сколько оценок из двух». */}
      <div
        className="mark"
        aria-hidden="true"
        style={{ color: approved ? 'var(--high)' : 'var(--ink-soft)' }}
      >
        {approved ? result.finalScore : `${result.reviewsSubmitted}/2`}
      </div>
      <h1>Оценка отправлена</h1>
      <p>
        {approved
          ? `Дело подтверждено: ${result.finalScore} баллов — среднее двух оценок. Автор уже увидел результат.`
          : 'Дело оценивают двое. Как только придёт вторая оценка, автор получит их среднее.'}
      </p>
      <p className="footer">Karma Builder</p>
    </main>
  );
}

export default function App() {
  const token = tokenFromLocation();

  const [page, setPage] = useState<ReviewPage | null>(null);
  const [failure, setFailure] = useState<string | null>(token ? null : 'link_invalid');
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    fetchReviewPage(token)
      .then((data) => {
        if (cancelled) return;
        setPage(data);
        // Стартуем с подсказки системы: у рецензента должна быть точка отсчёта,
        // а не пустой ноль, от которого одинаково далеко во все стороны.
        setScore(data.deed.baseScore);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(error instanceof ApiError ? error.code : 'unknown');
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (failure) return <Failure code={failure} />;
  if (result) return <Thanks result={result} />;

  if (!page) {
    return (
      <main className="page" aria-busy="true">
        <p className="eyebrow">Karma Builder</p>
        <div className="skeleton" />
        <div className="skeleton" />
      </main>
    );
  }

  const category = CATEGORY_META[page.deed.category as DeedCategory] ?? CATEGORY_META.other;
  const effort = EFFORT_META[page.deed.effortLevel as EffortLevel];
  const author = page.author.firstName?.trim() || 'Автор';

  async function send() {
    if (!token) return;
    setSending(true);
    setSendError(null);
    try {
      setResult(await submitReview(token, score, comment));
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'unknown';
      // Мёртвую ссылку показываем отдельным экраном, остальное — строкой у кнопки:
      // из первого случая выхода нет, из второго есть.
      if (code === 'network' || code === 'invalid_score' || code === 'unknown') {
        setSendError(
          code === 'network'
            ? 'Не удалось отправить — проверьте связь и попробуйте ещё раз.'
            : 'Не удалось отправить оценку. Попробуйте ещё раз.',
        );
        setSending(false);
      } else {
        setFailure(code);
      }
    }
  }

  return (
    <main className="page">
      <header>
        <p className="eyebrow">Karma Builder · оценка дела</p>
        <h1>{author} просит оценить доброе дело</h1>
        <p className="lede">
          Оценку ставят два человека независимо друг от друга. Итогом станет среднее — регистрация
          не нужна, это займёт полминуты.
        </p>
      </header>

      <article className="deed">
        <p className="deed-category">
          <span aria-hidden="true">{category.icon}</span>
          {category.label}
        </p>
        <p className="deed-text">{page.deed.description || 'Автор не оставил описания'}</p>
        <p className="deed-meta">
          <span>{effort.hint}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDeedTime(sqlToEpoch(page.deed.createdAt))}</span>
        </p>
      </article>

      <Scale
        value={score}
        max={page.maxScore}
        anchors={page.anchors}
        baseScore={page.deed.baseScore}
        onChange={setScore}
      />

      <label>
        <span className="eyebrow">Комментарий автору — по желанию</span>
        <textarea
          className="comment"
          value={comment}
          maxLength={REVIEW_COMMENT_MAX_LENGTH}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Что показалось важным в этом деле?"
          style={{ marginTop: 8 }}
        />
      </label>

      {sendError && <p className="error-note">{sendError}</p>}

      <button className="submit" type="button" onClick={send} disabled={sending}>
        {sending ? 'Отправляем…' : 'Отправить оценку'}
      </button>
      <p className="form-note">Оценку можно отправить один раз, изменить её потом нельзя.</p>
    </main>
  );
}
