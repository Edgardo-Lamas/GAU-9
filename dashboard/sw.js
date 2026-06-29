const CACHE_VERSION  = 'gau9-v7';
const CACHE_STATIC   = `${CACHE_VERSION}-static`;
const CACHE_API      = `${CACHE_VERSION}-api`;

// Archivos del shell de la app — cache permanente
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/manifest.json',
  '/icons/icon.svg',
];

// Rutas de API con Cache First (datos del día, cambian con sync periódico)
const CACHE_FIRST_PATTERNS = [
  '/api/presentismo/hoy',
  '/api/civiles/hoy',
  '/api/traslados/hoy',
];

// ── INSTALL ─────────────────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ────────────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('gau9-') && k !== CACHE_STATIC && k !== CACHE_API)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ────────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Solo interceptar misma origen
  if (url.origin !== location.origin) return;

  const path = url.pathname;

  // Archivos estáticos: Cache First con fallback a red
  if (!path.startsWith('/api/')) {
    e.respondWith(cacheFirstStatic(request));
    return;
  }

  // API /hoy y similares: Cache First (datos del día)
  if (CACHE_FIRST_PATTERNS.some(p => path.startsWith(p))) {
    e.respondWith(cacheFirstApi(request));
    return;
  }

  // Resto de API: Network First con fallback a cache
  e.respondWith(networkFirstApi(request));
});

async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    return caches.match('/index.html');
  }
}

async function cacheFirstApi(request) {
  const cached = await caches.match(request, { cacheName: CACHE_API });
  if (cached) {
    // Actualizar en background
    fetch(request)
      .then(res => {
        if (res.ok) {
          caches.open(CACHE_API).then(c => c.put(request, res));
        }
      })
      .catch(() => {});
    return cached;
  }
  return networkFirstApi(request);
}

async function networkFirstApi(request) {
  try {
    const res = await fetch(request);
    if (res.ok && request.method === 'GET') {
      const cache = await caches.open(CACHE_API);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(request, { cacheName: CACHE_API });
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Sin conexión' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ── BACKGROUND SYNC ─────────────────────────────────────────────
// Cola de traslados creados offline
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-traslados') {
    e.waitUntil(procesarColaPendiente());
  }
});

async function procesarColaPendiente() {
  const clients = await self.clients.matchAll();
  // Notificar a la app para que procese la cola de IndexedDB
  clients.forEach(c => c.postMessage({ tipo: 'sync-completado' }));
}
