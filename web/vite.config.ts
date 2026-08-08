import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brand } from './brand.config.ts';

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root,
  plugins: [
    {
      name: 'white-label-html',
      transformIndexHtml: (html) => html
        .replace('<title>Tally</title>', `<title>${brand.name}</title>`)
        .replace('A self-hosted, white-label companion for your YNAB budget.', brand.description),
    },
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: brand.name,
        short_name: brand.name,
        description: brand.description,
        theme_color: brand.themeColor,
        background_color: brand.backgroundColor,
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/brand/icon-128.png', sizes: '128x128', type: 'image/png' },
          { src: '/brand/icon-256.png', sizes: '256x256', type: 'image/png' },
          { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/brand/icon-1024.png', sizes: '1024x1024', type: 'image/png' },
        ],
      },
      workbox: { navigateFallback: '/index.html', runtimeCaching: [{ urlPattern: /\/api\//, handler: 'NetworkFirst', options: { cacheName: 'ynab-api', networkTimeoutSeconds: 3 } }] },
    }),
  ],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000', '/auth': 'http://localhost:3000', '/health': 'http://localhost:3000', '/public-config': 'http://localhost:3000', '/webhooks': 'http://localhost:3000' } },
});
