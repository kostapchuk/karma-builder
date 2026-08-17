/**
 * Отправка ссылок наружу.
 *
 * Урок V1: ответ клиента Telegram нельзя считать гарантированным. Любой вызов
 * через postEvent закрываем таймаутом и всегда оставляем путь отхода —
 * скопировать ссылку в буфер. Без ссылки на руках дело просто не проверят.
 */

'use client';

import { copyTextToClipboard, openTelegramLink, shareURL } from '@telegram-apps/sdk-react';

import { isInTelegram } from './init';

export type ShareOutcome = 'shared' | 'copied' | 'failed';

const CALL_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms = CALL_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function copy(text: string): Promise<boolean> {
  // copyTextToClipboard сам выбирает между методом Telegram и Clipboard API,
  // но в webview может не ответить — отсюда таймаут и запасной путь.
  try {
    await withTimeout(copyTextToClipboard(text));
    return true;
  } catch {
    // Провалимся в браузерный clipboard ниже.
  }
  try {
    await withTimeout(navigator.clipboard.writeText(text));
    return true;
  } catch {
    return false;
  }
}

/**
 * Нативный share Telegram — «отправить другу» в один тап, без выхода из клиента.
 * Не получилось — кладём ссылку в буфер и говорим об этом словами.
 */
export async function shareLink(url: string, text: string): Promise<ShareOutcome> {
  if (isInTelegram()) {
    try {
      if (shareURL.isAvailable()) {
        shareURL(url, text);
        return 'shared';
      }
      if (openTelegramLink.isAvailable()) {
        const share = new URL('https://t.me/share/url');
        share.searchParams.set('url', url);
        share.searchParams.set('text', text);
        openTelegramLink(share.toString());
        return 'shared';
      }
    } catch {
      // Клиент не ответил — остаётся буфер обмена.
    }
  }

  return (await copy(url)) ? 'copied' : 'failed';
}

/** Ссылка-приглашение в друзья: тот же путь, другой текст. */
export const shareInvite = (url: string) =>
  shareLink(url, 'Считаю добрые дела в Karma Builder. Давай сравним карму?');
