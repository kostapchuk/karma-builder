'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { backButton } from '@telegram-apps/sdk-react';

import { initTelegram, isInTelegram } from '@/lib/telegram/init';
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

  useEffect(() => {
    initTelegram();
    setBooted(true);
    void hydrate();
  }, [hydrate]);

  useBackButton();

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
            <button className="btn secondary" onClick={() => window.location.reload()}>
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
