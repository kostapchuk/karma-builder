/**
 * Инициализация Telegram SDK.
 *
 * Все вызовы обёрнуты в `safe`: часть компонентов недоступна на старых
 * клиентах, и падение одного из них не должно ронять приложение целиком.
 */

import {
  backButton,
  emitEvent,
  init as initSdk,
  mainButton,
  miniApp,
  mockTelegramEnv,
  restoreInitData,
  swipeBehavior,
  themeParams,
  viewport,
} from '@telegram-apps/sdk-react';

let initialized = false;
let inTelegramEnv = false;

/**
 * Работаем ли внутри настоящего клиента Telegram.
 *
 * Важно для нативных кнопок: в дев-моке MainButton успешно «монтируется»,
 * но рисовать её некому — экраны должны показать свою кнопку в разметке.
 */
export function isInTelegram(): boolean {
  return inTelegramEnv;
}

/**
 * Есть ли канал связи с клиентом Telegram.
 *
 * Проверяем именно транспорт, а не `isTMA()`: тот отвечает по launch params
 * из sessionStorage, которые туда кладёт и дев-мок — после первой же
 * перезагрузки страницы браузер начал бы выдавать себя за Telegram.
 */
function hasTelegramTransport(): boolean {
  if (typeof window === 'undefined') return false;
  const withProxy = window as unknown as { TelegramWebviewProxy?: unknown };
  // Мобильные клиенты кладут webview-прокси, web и desktop открывают в iframe.
  return Boolean(withProxy.TelegramWebviewProxy) || window.parent !== window;
}

function safe(label: string, fn: () => unknown): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.catch((error) => console.warn(`[tg] ${label} failed`, error));
    }
  } catch (error) {
    console.warn(`[tg] ${label} failed`, error);
  }
}

/**
 * Вне Telegram (обычный браузер на `next dev`) окружения нет и SDK бросает
 * UnknownEnvError. Подменяем launch params, чтобы разработка не требовала
 * туннеля на каждый чих. В проде мок не подключается никогда.
 */
function mockDevEnvironment(): void {
  if (process.env.NODE_ENV === 'production') return;

  const themeParamsMock = {
    accent_text_color: '#6ab2f2',
    bg_color: '#17212b',
    button_color: '#5288c1',
    button_text_color: '#ffffff',
    destructive_text_color: '#ec3942',
    header_bg_color: '#17212b',
    hint_color: '#708499',
    link_color: '#6ab3f3',
    secondary_bg_color: '#232e3c',
    section_bg_color: '#17212b',
    section_header_text_color: '#6ab3f3',
    subtitle_text_color: '#708499',
    text_color: '#f5f5f5',
  } as const;

  mockTelegramEnv({
    launchParams: {
      tgWebAppThemeParams: themeParamsMock,
      tgWebAppVersion: '8.0',
      tgWebAppPlatform: 'tdesktop',
      tgWebAppData: new URLSearchParams([
        ['auth_date', String(Math.floor(Date.now() / 1000))],
        ['hash', 'devmode'],
        ['signature', 'devmode'],
        [
          'user',
          JSON.stringify({
            id: 1,
            first_name: 'Dev',
            last_name: 'User',
            username: 'devuser',
            language_code: 'ru',
          }),
        ],
      ]),
    },
    // Вне Telegram отвечать на вызовы методов некому, поэтому отвечаем сами.
    // CloudStorage сознательно НЕ мокаем: в дев-режиме приложение уходит
    // на localStorage — заодно этот путь и проверяется на каждом запуске.
    onEvent([event, payload], next) {
      switch (event) {
        // Отвечаем отказом сразу, иначе запрос провисит до таймаута драйвера.
        case 'web_app_invoke_custom_method':
          return emitEvent('custom_method_invoked', {
            req_id: (payload as { req_id: string }).req_id,
            error: 'CLOUD_STORAGE_UNAVAILABLE_IN_DEV',
          });
        case 'web_app_request_theme':
          return emitEvent('theme_changed', { theme_params: themeParamsMock });
        case 'web_app_request_viewport':
          return emitEvent('viewport_changed', {
            height: window.innerHeight,
            width: window.innerWidth,
            is_state_stable: true,
            is_expanded: true,
          });
        case 'web_app_request_safe_area':
          return emitEvent('safe_area_changed', { top: 0, bottom: 0, left: 0, right: 0 });
        case 'web_app_request_content_safe_area':
          return emitEvent('content_safe_area_changed', {
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
          });
        default:
          return next();
      }
    },
  });
}

export interface TelegramEnv {
  /** Работаем ли внутри реального клиента Telegram. */
  inTelegram: boolean;
}

export function initTelegram(): TelegramEnv {
  if (initialized) return { inTelegram: inTelegramEnv };
  initialized = true;

  const inTelegram = hasTelegramTransport();
  inTelegramEnv = inTelegram;

  if (!inTelegram) mockDevEnvironment();

  safe('init', () => initSdk());
  safe('restoreInitData', () => restoreInitData());

  // Тема клиента → CSS-переменные --tg-theme-*. Своей палитры не навязываем.
  safe('themeParams', () => {
    themeParams.mountSync();
    themeParams.bindCssVars();
  });

  safe('miniApp', () => {
    miniApp.mountSync();
    miniApp.bindCssVars();
  });

  // Без expand() приложение открывается «половинкой», без bindCssVars
  // контент уезжает под клавиатуру и системные панели.
  safe('viewport', async () => {
    await viewport.mount();
    viewport.expand();
    viewport.bindCssVars();
  });

  // Иначе скролл списка дел закрывает Mini App случайным свайпом вниз.
  safe('swipeBehavior', () => {
    swipeBehavior.mount();
    swipeBehavior.disableVertical();
  });

  safe('backButton', () => backButton.mount());
  safe('mainButton', () => mainButton.mount());
  safe('ready', () => miniApp.ready());

  return { inTelegram };
}
