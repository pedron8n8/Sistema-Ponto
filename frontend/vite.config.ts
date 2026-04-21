import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-icon.svg', 'pwa-maskable.svg'],
      manifest: {
        id: '/',
        name: 'OmniPunt',
        short_name: 'OmniPunt',
        description: 'OmniPunt: controle de ponto com aprovacoes e relatorios.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        theme_color: '#0f766e',
        background_color: '#f5f3ef',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
          },
          {
            src: 'pwa-maskable.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
})
