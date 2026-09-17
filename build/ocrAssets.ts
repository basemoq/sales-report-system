import { createRequire } from 'node:module'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Serves the WebAssembly this app reads receipts with — the OCR engine and the
 * barcode reader — from this app rather than from a CDN.
 *
 * Both tesseract.js and zxing-wasm reach for jsdelivr by default. This app is
 * installed as an offline PWA and used in a showroom, so a receipt has to stay
 * readable when the network is not — and a third party in the loading path of
 * something that reads customer receipts is a dependency worth not having. The
 * files come out of node_modules, so nothing binary is committed and the
 * versions follow the lockfile.
 */

const require = createRequire(import.meta.url)

/**
 * The engine is asked for LSTM recognition only, which is the half of Tesseract
 * that reads a receipt; each build is the one a browser picks by the SIMD it
 * has, so all three ship and exactly one is fetched.
 */
const CORE_FILES = [
  'tesseract-core-lstm.wasm',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
]

/**
 * `best_int` rather than the full model: a quarter of the size for the same
 * reading of printed receipt text, and it is downloaded over a phone's
 * connection.
 */
const LANG_VARIANT = '4.0.0_best_int'

function sources(): Record<string, string> {
  const core = dirname(require.resolve('tesseract.js-core/package.json'))
  const lang = dirname(require.resolve('@tesseract.js-data/eng/package.json'))
  const worker = require.resolve('tesseract.js/dist/worker.min.js')
  // The package publishes the wasm as an export of its own rather than letting
  // its folder be resolved.
  const zxing = require.resolve('zxing-wasm/reader/zxing_reader.wasm')

  const files: Record<string, string> = {
    'ocr/worker.min.js': worker,
    'ocr/eng.traineddata.gz': join(lang, LANG_VARIANT, 'eng.traineddata.gz'),
    'barcode/zxing_reader.wasm': zxing,
  }
  for (const name of CORE_FILES) files[`ocr/${name}`] = join(core, name)
  return files
}

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
}

const typeOf = (name: string): string =>
  TYPES[Object.keys(TYPES).find((extension) => name.endsWith(extension)) ?? ''] ??
  'application/octet-stream'

export function wasmAssets(): Plugin {
  return {
    name: 'wasm-assets',

    // In dev the files are streamed straight out of node_modules; copying them
    // into public/ would put ~14MB of build output under version control.
    configureServer(server) {
      const files = sources()
      server.middlewares.use(async (request, response, next) => {
        const path = (request.url ?? '').split('?')[0]
        const name = Object.keys(files).find((file) => path.endsWith(`/${file}`))
        if (name === undefined) return next()

        response.setHeader('Content-Type', typeOf(name))
        response.end(await readFile(files[name]))
      })
    },

    async writeBundle(options) {
      const out = options.dir ?? 'dist'
      const files = sources()
      for (const [name, from] of Object.entries(files)) {
        await mkdir(join(out, dirname(name)), { recursive: true })
        await copyFile(from, join(out, name))
      }
    },
  }
}
