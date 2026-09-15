/*
 * Bundles each middleman into one dependency-free file.
 *
 * The Worker's goes to worker/dist/worker.js, for pasting into the Cloudflare
 * dashboard editor; the Vercel function's to vercel/api/receipt.js, which is
 * what Vercel deploys. Both are generated from the same source — the URL check
 * and the parser are shared — so the two can never drift apart.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

execFileSync('npx', ['tsc', '--noEmit', 'false', '--outDir', 'build', '--target', 'es2022',
  '--module', 'esnext', '--moduleResolution', 'bundler', '--skipLibCheck', 'true',
  'src/index.ts', '../vercel/src/handler.ts'],
  { stdio: 'inherit' })

const read = (path) => readFileSync(path, 'utf8')
const withoutImports = (code) => code.replace(/^import[^\n]*\n/gm, '')
/** Shared modules are inlined, so their exports become plain declarations. */
const inlined = (path) => withoutImports(read(path)).replace(/^export /gm, '')

const banner = (name) =>
  `/*\n * قارئ إيصال مدى — ${name}\n` +
  ` * مولَّد من worker/src و vercel/src في مستودع sales-report-system.\n` +
  ` * لا تحرّره هنا؛ عدّل المصدر ثم أعد توليده بـ node worker/build.mjs\n */\n\n`

// tsc mirrors the source tree once a file outside src is compiled with it.
const base = 'build/worker/src'
const shared = inlined(`${base}/receiptUrl.js`) + '\n' + inlined(`${base}/parse.js`)

mkdirSync('dist', { recursive: true })
writeFileSync(
  'dist/worker.js',
  banner('ملف واحد للصق في محرّر Cloudflare Workers.') +
    shared +
    '\n' +
    withoutImports(read(`${base}/index.js`)),
)

mkdirSync('../vercel/api', { recursive: true })
writeFileSync(
  '../vercel/api/receipt.js',
  banner('دالة Vercel (Node runtime).') +
    shared +
    '\n' +
    withoutImports(read('build/vercel/src/handler.js')),
)

console.log('dist/worker.js and ../vercel/api/receipt.js written')
