import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const vapidFile = resolve(__dirname, '../infra/vapid_public.txt');
const vapid = existsSync(vapidFile) ? readFileSync(vapidFile, 'utf8').trim() : '';

export default defineConfig({
  base: '/',
  plugins: [react()],
  define: {
    __VAPID_FILE__: JSON.stringify(vapid),
    __APP_VERSION__: JSON.stringify('1.0.0'),
  },
  server: { fs: { allow: ['..'] } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
