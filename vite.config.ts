import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5174, host: '127.0.0.1', watch: { ignored: ['**/screenshots/**'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as any);
