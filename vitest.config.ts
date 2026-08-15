import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/**/*.test.{ts,tsx}'],
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
