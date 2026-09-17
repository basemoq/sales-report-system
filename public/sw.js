/// <reference lib="webworker" />
// Bump to evict every cached asset from an earlier deploy.
const CACHE = 'sales-report-v1'

// The app is served from a subpath on GitHub Pages, so the shell is resolved
// against this worker's own location rather than assumed to sit at the root.
const SHELL = new URL('index.html', self.location.href).href

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Navigations: serve fresh HTML when online, fall back to the cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          const cache = await caches.open(CACHE)
          cache.put(SHELL, response.clone())
          return response
        } catch {
          const cached = await caches.match(SHELL)
          if (cached) return cached
          throw new Error('offline and no cached shell')
        }
      })(),
    )
    return
  }

  // Build output is content-hashed, so a cache hit is always the right bytes.
  // The OCR engine under /ocr/ is the exception: those names are fixed, so they
  // are held by the pinned dependency version and only replaced when CACHE above
  // is bumped. Bump it when the OCR engine moves.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) {
        const cache = await caches.open(CACHE)
        cache.put(request, response.clone())
      }
      return response
    })(),
  )
})
