import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [react(), tailwindcss()],
    // Tauri expectes a fixed port in dev mode
    server: {
        port: 3001,
        strictPort: true,
        fs: {
            // Allow serving files from one level up (the root project)
            allow: ['../'],
        },
    },
    // Setting base to './' for Tauri file:// protocol compatibility
    base: './',
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '../'),
            '@tauri-apps/plugin-dialog': path.resolve(__dirname, './node_modules/@tauri-apps/plugin-dialog'),
            '@tauri-apps/plugin-fs': path.resolve(__dirname, './node_modules/@tauri-apps/plugin-fs'),
            '@tauri-apps/api': path.resolve(__dirname, './node_modules/@tauri-apps/api'),
        },
    },
    build: {
        // Generate the desktop build in a distinct folder
        outDir: './dist-desktop',
        emptyOutDir: true,
        target: 'esnext',
    },
});
