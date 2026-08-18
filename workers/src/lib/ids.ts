/** Идентификаторы. Единственный источник случайности — crypto.getRandomValues. */

/** URL-safe алфавит nanoid. Ровно 64 символа — см. проверку в тестах. */
export const ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

export function randomId(size: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let out = '';
  // 64 символа ровно, поэтому маска 63 покрывает алфавит целиком и не смещает
  // распределение. Символом меньше — и часть байт давала бы undefined в токене.
  for (const byte of bytes) out += ALPHABET[byte & 63];
  return out;
}

/** Токен ревью: 32 символа ≈ 192 бита — перебор по URL нереален. */
export const reviewToken = () => randomId(32);

export const deedId = () => randomId(16);
