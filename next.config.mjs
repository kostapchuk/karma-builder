/** @type {import('next').NextConfig} */
const nextConfig = {
  // Серверной логики нет: Mini App — это статическая страница в webview Telegram.
  output: 'export',
  // Telegram открывает URL как есть; со слешем на конце статика резолвится
  // одинаково и на Vercel, и на любом другом хостинге.
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
