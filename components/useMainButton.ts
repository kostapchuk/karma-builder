'use client';

import { useEffect, useRef, useState } from 'react';
import { mainButton } from '@telegram-apps/sdk-react';

import { isInTelegram } from '@/lib/telegram/init';

interface MainButtonOptions {
  text: string;
  onClick: () => void;
  enabled?: boolean;
}

/**
 * Основное действие экрана — нативной MainButton Telegram.
 *
 * Возвращает `false`, если кнопка недоступна (старый клиент или обычный
 * браузер) — тогда экран рисует собственную кнопку в потоке страницы.
 */
export function useMainButton({ text, onClick, enabled = true }: MainButtonOptions): boolean {
  const [available, setAvailable] = useState(false);
  // Колбэк держим в ref: подписку на onClick не хочется пересоздавать
  // на каждый ререндер формы.
  const handler = useRef(onClick);
  handler.current = onClick;

  useEffect(() => {
    let off: (() => void) | undefined;
    try {
      if (!isInTelegram() || !mainButton.isMounted()) return;
      setAvailable(true);
      off = mainButton.onClick(() => handler.current());
    } catch {
      setAvailable(false);
    }
    return () => {
      off?.();
      try {
        mainButton.setParams({ isVisible: false });
      } catch {
        /* нечего скрывать */
      }
    };
  }, []);

  useEffect(() => {
    if (!available) return;
    try {
      mainButton.setParams({ text, isVisible: true, isEnabled: enabled });
    } catch {
      /* клиент не поддерживает — работает фолбэк в разметке */
    }
  }, [available, text, enabled]);

  return available;
}
