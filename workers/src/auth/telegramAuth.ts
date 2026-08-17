/**
 * Валидация Telegram initData.
 *
 * В V1 сервера не было и проверять было нечем — из initData брали только имя.
 * Здесь она становится единственным способом узнать, кто пришёл.
 *
 * Сессий сознательно нет: SDK всегда отдаёт свежий initData, а HMAC в Workers
 * стоит доли миллисекунды. Это убирает хранение сессий, revoke и refresh.
 */

import { unauthorized } from '../http';

export interface TelegramUser {
  id: number;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
}

export interface InitData {
  user: TelegramUser;
  authDate: number;
  /** startapp-параметр deep-link: используется для добавления друзей */
  startParam: string | null;
}

/** Старше суток не принимаем — защита от replay украденной строки. */
export const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

const encoder = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Сравнение без ранних выходов: время не должно зависеть от совпавшего префикса. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function dataCheckString(params: URLSearchParams, skip: readonly string[]): string {
  return [...params.entries()]
    .filter(([key]) => !skip.includes(key))
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
}

/**
 * Алгоритм Telegram: secret_key = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN),
 * затем HMAC_SHA256(key=secret_key, msg=data_check_string) сверяется с `hash`.
 *
 * Поле `signature` (Ed25519-подпись для сторонней проверки) в некоторых версиях
 * клиента приходит вместе с остальными и в data_check_string не входит. Пробуем
 * обе раскладки: лишний HMAC дешевле, чем 401 у части пользователей.
 */
export async function validateInitData(
  raw: string,
  botToken: string,
  now: number = Math.floor(Date.now() / 1000),
  maxAgeSeconds: number = MAX_AUTH_AGE_SECONDS,
): Promise<InitData> {
  if (!raw) throw unauthorized('init_data_missing');
  if (!botToken) throw unauthorized('bot_token_missing');

  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash) throw unauthorized('init_data_no_hash');

  const secretKey = await hmac(encoder.encode('WebAppData'), botToken);

  const variants = params.has('signature')
    ? [dataCheckString(params, ['hash']), dataCheckString(params, ['hash', 'signature'])]
    : [dataCheckString(params, ['hash'])];

  let ok = false;
  for (const candidate of variants) {
    if (timingSafeEqual(toHex(await hmac(secretKey, candidate)), hash)) ok = true;
  }
  if (!ok) throw unauthorized('init_data_bad_hash');

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) throw unauthorized('init_data_no_auth_date');
  if (now - authDate > maxAgeSeconds) throw unauthorized('init_data_expired');

  const userRaw = params.get('user');
  if (!userRaw) throw unauthorized('init_data_no_user');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(userRaw);
  } catch {
    throw unauthorized('init_data_bad_user');
  }

  const id = Number(parsed.id);
  if (!Number.isFinite(id) || id <= 0) throw unauthorized('init_data_bad_user');

  return {
    user: {
      id,
      username: typeof parsed.username === 'string' ? parsed.username : null,
      firstName: typeof parsed.first_name === 'string' ? parsed.first_name : null,
      photoUrl: typeof parsed.photo_url === 'string' ? parsed.photo_url : null,
    },
    authDate,
    startParam: params.get('start_param'),
  };
}
