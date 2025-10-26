// @ts-nocheck
import { defineConfig } from 'vite';           // splitVendorChunkPlugin raus
import react from '@vitejs/plugin-react';
import compression from 'vite-plugin-compression';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: '/Circles/',
  plugins: [
    react(),
    compression({ algorithm: 'brotliCompress' }),
    compression({ algorithm: 'gzip' }),
    // VitePWA(...), falls vorhanden, bleibt
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['country-state-city'],
  },
  build: {
    sourcemap: false,
    target: 'es2020',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});