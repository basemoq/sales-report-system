/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { ocrAssets } from './build/ocrAssets.js'

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/, so every asset URL needs that
  // prefix. Overridable for a deploy that sits at a domain root.
  base: process.env.BASE_PATH ?? '/sales-report-system/',
  plugins: [react(), ocrAssets()],
  test: {
    environment: 'node',
    // The Worker's parser is plain TypeScript and is tested with the app.
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'worker/src/**/*.test.ts',
      'vercel/src/**/*.test.ts',
    ],
  },
})
