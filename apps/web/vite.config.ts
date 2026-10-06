import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Même origine pour l'API et le temps réel en local (comme derrière Caddy en production).
const devProxy = {
  '/api': 'http://127.0.0.1:4380',
  '/ws': { target: 'ws://127.0.0.1:4381', ws: true },
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Seule la coquille applicative est mise en cache hors ligne.
      // Les réponses d'API ne sont PAS mises en cache par le service worker : le cache
      // révélerait sur l'appareil les zones consultées (≈ historique de position).
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api\//, /^\/tiles\//],
        runtimeCaching: [],
      },
      manifest: {
        name: 'SafeWay',
        short_name: 'SafeWay',
        description: 'Informations communautaires anonymes et éphémères pour se déplacer plus sûrement.',
        lang: 'fr',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0b0d10',
        background_color: '#0b0d10',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    // Cookies SameSite=Strict et WebAuthn simples grâce à la même origine.
    proxy: devProxy,
  },
  // `vite preview` applique la même CSP que la production (Caddyfile) pour la tester localement.
  preview: {
    port: 4173,
    proxy: devProxy,
    headers: {
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; child-src blob:; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), bluetooth=(), usb=(), payment=()',
      'Referrer-Policy': 'no-referrer',
    },
  },
  // Le worker MapLibre 6 est un module ES : on le garde en ES une fois empaqueté.
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Bibliothèques lourdes et stables dans des chunks séparés : une mise à jour de l'app
        // ne force pas à retélécharger MapLibre (réseaux saturés, §26).
        manualChunks: {
          maplibre: ['maplibre-gl', 'pmtiles', '@protomaps/basemaps'],
          h3: ['h3-js'],
        },
      },
    },
  },
});
