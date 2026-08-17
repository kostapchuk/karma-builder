/**
 * Подпись initData тем же алгоритмом, что и Telegram: тесты должны проходить
 * настоящую проверку, а не мок вокруг неё.
 */

import { createHmac } from 'node:crypto';

export interface FakeUser {
  id: number;
  username?: string;
  first_name?: string;
  photo_url?: string;
}

export function signInitData(
  botToken: string,
  user: FakeUser,
  options: { authDate?: number; startParam?: string; extra?: Record<string, string> } = {},
): string {
  const params = new URLSearchParams({
    user: JSON.stringify(user),
    auth_date: String(options.authDate ?? Math.floor(Date.now() / 1000)),
    query_id: 'AAExampleQueryId',
    ...(options.startParam ? { start_param: options.startParam } : {}),
    ...(options.extra ?? {}),
  });

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  params.set('hash', hash);
  return params.toString();
}
