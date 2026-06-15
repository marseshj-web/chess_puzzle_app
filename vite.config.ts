import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Lichess 퍼즐 트레이너',
        short_name: '퍼즐 트레이너',
        description: 'Lichess 전술 퍼즐 트레이너 — 복기와 Stockfish 분석',
        lang: 'ko',
        dir: 'ltr',
        theme_color: '#1c1c2b',
        background_color: '#1c1c2b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell only. Big assets (data/engine) are cached at runtime as used.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        globIgnores: ['**/engine/**', '**/data/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Puzzle data buckets (~16MB total, fetched per rating range on demand).
            urlPattern: ({ url }) => url.pathname.startsWith('/data/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'puzzle-data',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Stockfish engine (~40MB NNUE + wasm + worker js); cache once, then runs offline.
            urlPattern: ({ url }) => url.pathname.startsWith('/engine/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'stockfish-engine',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
})
