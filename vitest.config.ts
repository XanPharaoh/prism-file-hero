import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { provisionAppOcrAssets } from './scripts/lib/app-ocr-assets.mjs';

// `npm test` runs before any build in CI, and this config does not extend vite.config.ts — so without
// this the suite would look for public/ocr, not find it, and hang waiting for a Tesseract worker that
// can never load its language model. That is exactly what broke run 40334457398: green locally because
// a build had already run, red in CI. Provisioning here makes the harness self-sufficient in the same
// way a build is, from the installed packages and with no network.
provisionAppOcrAssets({ root: __dirname, quiet: true });

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/**/*.test.{ts,tsx}'],
        maxWorkers: 8,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'text-summary'],
            include: ['services/**/*.ts', 'App.tsx', 'types.ts'],
        },
    },
    resolve: {
        alias: [
            { find: '@', replacement: path.resolve(__dirname, '.') },
            // Keep tests on PDF.js's Node-safe legacy entry without intercepting
            // the browser worker asset imported by the shared client facade.
            { find: /^pdfjs-dist$/, replacement: path.resolve(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs') },
        ],
    },
});
