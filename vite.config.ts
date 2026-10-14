import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    clearScreen: false,
    // The release artifact mounts the app at /app next to the static marketing site, so any build
    // must emit absolute /app/ asset URLs — relative ones break on a deep-link refresh such as
    // /app/merge-pdf. Dev keeps the root so /app and /ocr-pdf stay reachable as they always have.
    // Keyed off the command, not the mode name, so `--mode staging` produces the same layout.
    base: command === 'build' ? '/app/' : '/',
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    worker: {
      format: 'es',
    },
    plugins: [
      react(),
      tailwindcss(),
    ],
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react-router-dom',
        '@clerk/react',
        'pdf-lib',
        'pdfjs-dist',
        'docx',
        'xlsx',
        'exceljs',
        'jszip',
        'tesseract.js',
        'zustand',
        'lucide-react',
      ],
      esbuildOptions: {
        target: 'esnext',
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 2500, // Increased since we let Vite chunk naturally
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id && id.includes('node_modules')) {
              // Only separate out truly independent, non-circular libraries
              if (id.includes('lucide-react')) {
                return 'icons';
              }
              if (id.includes('react') || id.includes('react-dom')) {
                return 'vendor';
              }
              // Let pdfjs-dist, pdf-lib, and xlsx be chunked naturally by Rollup
              // (forcing them into manual chunks causes circular dependency initialization errors)
            }
          },
        },
      },
    }
  };
});
