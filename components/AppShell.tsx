'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { backButton, initDataStartParam } from '@telegram-apps/sdk-react';

import { initTelegram, isInTelegram, reviewTokenFromStartParam } from '@/lib/telegram/init';
import { useAppStore } from '@/lib/store/useAppStore';

/**
 * Единственная точка инициализации: SDK поднимается до гидратации store,
 * потому что драйвер хранилища решает, доступен ли CloudStorage, уже после
 * `init()`.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [booted, setBooted] = useState(false);
  const status = useAppStore((s) => s.status);
  const error = useAppStore((s) => s.error);
  const hydrate = useAppStore((s) => s.hydrate);
  // Повтор после сбоя сети: перезагружать webview целиком не нужно.
  const retry = hydrate;

  useEffect(() => {
    // Порядок важен: store читает initData из SDK, значит SDK должен встать первым.
    void initTelegram().then(() => {
      setBooted(true);
      return hydrate();
    });
  }, [hydrate]);

  useBackButton();
  useReviewDeepLink(booted);

  if (!booted || status === 'idle' || status === 'loading') {
    return (
      <div className="page">
        <div className="empty">
          <span className="emoji">🌱</span>
          Загружаем карму…
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="page">
        <div className="empty">
          <span className="emoji">😕</span>
          {error ?? 'Что-то пошло не так'}
          <p>
            <button className="btn secondary" onClick={() => void retry(true)}>
              Попробовать снова
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <FallbackBackLink />
      {children}
    </>
  );
}

/**
 * Токены, по которым уже увели на экран оценки в этом запуске приложения.
 *
 * `start_param` не расходуется сам: Telegram отдаёт его всё время, пока живёт
 * webview. Без отметки любой уход на главную снова кидал бы на `/rate`, а токен
 * там уже потрачен — получался экран «по этой ссылке уже оценили», из которого
 * не выйти. Список модульный, а не в sessionStorage: повторный запуск по той же
 * ссылке — новая загрузка страницы, и туда попасть снова можно.
 */
const consumedReviewTokens = new Set<string>();

/**
 * Ссылка на оценку ведёт в само приложение (`?startapp=r<token>`), а не на
 * отдельную страницу: только так сервер узнаёт, кто ставит балл, и не даёт
 * автору подтвердить своё же дело. Telegram открывает Mini App на корне,
 * поэтому распознать ссылку и увести на экран оценки приходится здесь.
 */
function useReviewDeepLink(booted: boolean) {
  const router = useRouter();

  useEffect(() => {
    if (!booted) return;

    let param: string | undefined;
    try {
      param = initDataStartParam();
    } catch {
      return;
    }
    const token = reviewTokenFromStartParam(param);
    if (!token || consumedReviewTokens.has(token)) return;

    // Отмечаем до перехода: эффект переживёт смену маршрута и иначе увёл бы
    // обратно, стоит пользователю уйти с экрана оценки.
    consumedReviewTokens.add(token);
    router.replace(`/rate/?t=${token}`);
  }, [booted, router]);
}

/** Нативная кнопка «назад» Telegram вместо собственной в интерфейсе. */
function useBackButton() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const isRoot = pathname === '/' || pathname === '';
    try {
      if (isRoot) {
        backButton.hide();
        return;
      }
      backButton.show();
      return backButton.onClick(() => router.back());
    } catch {
      // Старый клиент без BackButton — навигация остаётся системной.
    }
  }, [pathname, router]);
}

/** Вне Telegram нативную кнопку «назад» рисовать некому — даём свою. */
function FallbackBackLink() {
  const pathname = usePathname();
  const router = useRouter();

  if (isInTelegram() || pathname === '/' || pathname === '') return null;

  return (
    <button
      className="hint"
      style={{ padding: '12px 20px 0', display: 'block' }}
      onClick={() => router.back()}
    >
      ← Назад
    </button>
  );
}
