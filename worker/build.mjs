/*
 * Bundles the Worker into one file that can be pasted straight into the
 * Cloudflare dashboard editor — no terminal, no wrangler, no npm on the other
 * side. The two modules are concatenated in dependency order and the import
 * between them dropped, which is all the bundling a two-file Worker needs.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

execFileSync('npx', ['tsc', '--noEmit', 'false', '--outDir', 'build', '--target', 'es2022',
  '--module', 'esnext', '--moduleResolution', 'bundler', '--skipLibCheck', 'true'],
  { stdio: 'inherit' })

const parse = readFileSync('build/parse.js', 'utf8')
const index = readFileSync('build/index.js', 'utf8')
  .replace(/^import[^\n]*\n/gm, '')

mkdirSync('dist', { recursive: true })
writeFileSync(
  'dist/worker.js',
  `/*\n * قارئ إيصال مدى — ملف واحد للصق في محرّر Cloudflare Workers.\n` +
    ` * المصدر: worker/src في مستودع sales-report-system. لا تحرّره هنا؛ عدّل المصدر ثم\n` +
    ` * أعد توليد هذا الملف بـ node build.mjs\n */\n\n` +
    parse.replace(/^export /gm, '') +
    '\n' +
    index,
)
console.log('dist/worker.js written')
