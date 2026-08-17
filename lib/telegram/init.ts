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

let inTelegramEnv = false;
let devInitDataRaw: string | null = null;

/**
 * initData дев-мока — та самая строка, которую мы подписали.
 * Вне дев-режима null, и клиент API берёт настоящую из SDK.
 */
export function devInitData(): string | null {
  return devInitDataRaw;
}

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
 * Подпись дев-initData тем же алгоритмом, что и Telegram.
 *
 * В V1 здесь стояло `hash: 'devmode'` — проверять было нечему. В V2 Worker
 * валидирует HMAC на каждый запрос, и невалидная строка означала бы 401 на
 * весь дев-режим. Поэтому подписываем локальным токеном (тем же, что в
 * `workers/.dev.vars`): в браузере работает ровно тот же путь, что в Telegram.
 *
 * Настоящий токен бота сюда попасть не может: функция вызывается только из
 * дев-мока, а он выключен в production-сборке.
 */
async function signDevInitData(params: [string, string][]): Promise<string> {
  const token = process.env.NEXT_PUBLIC_DEV_BOT_TOKEN ?? 'local-dev-bot-token';
  const encoder = new TextEncoder();

  const sign = async (key: BufferSource, message: string) => {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  };

  const dataCheckString = params
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secret = await sign(encoder.encode('WebAppData'), token);
  const hash = await sign(secret, dataCheckString);

  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Вне Telegram (обычный браузер на `next dev`) окружения нет и SDK бросает
 * UnknownEnvError. Подменяем launch params, чтобы разработка не требовала
 * туннеля на каждый чих. В проде мок не подключается никогда.
 */
async function mockDevEnvironment(): Promise<void> {
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

  // `signature` обязателен: без него SDK не принимает tgWebAppData вовсе.
  // На проверку HMAC он не влияет — Worker пробует обе раскладки.
  const signedFields: [string, string][] = [
    ['auth_date', String(Math.floor(Date.now() / 1000))],
    ['query_id', 'dev-query-id'],
    ['signature', 'dev-signature'],
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
  ];

  const raw = new URLSearchParams([
    ...signedFields,
    ['hash', await signDevInitData(signedFields)],
  ]);
  // Строку запоминаем ровно в том виде, в каком подписали: SDK разбирает
  // initData в объект и собирает обратно сам, а любая пересборка JSON юзера
  // ломает HMAC. В проде это значение остаётся null.
  devInitDataRaw = raw.toString();

  mockTelegramEnv({
    launchParams: {
      tgWebAppThemeParams: themeParamsMock,
      tgWebAppVersion: '8.0',
      tgWebAppPlatform: 'tdesktop',
      tgWebAppData: raw,
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

/**
 * Инициализация запускается один раз, но дождаться её могут несколько раз:
 * в дев-режиме React вызывает эффекты дважды, и второй вызов не должен
 * возвращать «готово» раньше, чем закончился первый. Иначе store уйдёт
 * за данными с ещё не подписанным initData.
 */
export function initTelegram(): Promise<TelegramEnv> {
  boot ??= startTelegram();
  return boot;
}

let boot: Promise<TelegramEnv> | null = null;

async function startTelegram(): Promise<TelegramEnv> {
  const inTelegram = hasTelegramTransport();
  inTelegramEnv = inTelegram;

  // Подпись дев-initData асинхронная (crypto.subtle), поэтому вся инициализация
  // стала асинхронной: мок обязан встать до init() SDK.
  if (!inTelegram) await mockDevEnvironment();

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
