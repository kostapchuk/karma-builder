import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Серверной логики нет: Mini App — это статическая страница в webview Telegram.
  output: 'export',
  // Telegram открывает URL как есть; со слешем на конце статика резолвится
  // одинаково и на Vercel, и на любом другом хостинге.
  trailingSlash: true,
  images: { unoptimized: true },
  // Версия вшивается на сборке: экспорт статический, читать package.json
  // в рантайме неоткуда. Источник один — поле version, его двигает pre-push.
  env: { NEXT_PUBLIC_APP_VERSION: version },
};

export default nextConfig;
