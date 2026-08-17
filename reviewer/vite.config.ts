import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Страница импортирует подписи категорий из общего ядра выше по дереву.
    fs: { allow: ['..'] },
  },
  build: { outDir: 'dist', sourcemap: false },
});
