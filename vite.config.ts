import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Drop the warning threshold; with manualChunks below the largest
    // chunk should be the videojs one (~700KB) which we lazy-load on /watch.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('video.js') || id.includes('@videojs')) return 'videojs';
          if (id.includes('react-router')) return 'react-router';
          if (id.includes('react-dom')) return 'react-dom';
          if (id.includes('/react/')) return 'react';
          if (id.includes('better-auth')) return 'better-auth';
          if (id.includes('@hotwired/turbo')) return 'turbo';
          // web-vitals is only reached via the lazy import('./lib/rum'),
          // so isolating it keeps the eager `vendor` chunk smaller.
          if (id.includes('web-vitals')) return 'web-vitals';
          // Group long-tail node_modules together so we don't end up with
          // dozens of tiny chunks (cf. https://rolldown.rs/reference/OutputOptions).
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    // Proxy API requests to wrangler dev during local development
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
