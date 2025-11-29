// service-worker.js - versão simples e segura para PWA + pré-cache
const CACHE_NAME = 'falcoes-app-v1';
const PRECACHE_URLS = [
  '/',                      // se servidor servir root
  '/index.html',
  '/admin.html',
  '/cadastro.html',
  '/cliente.html',
  '/motoboy.html',
  '/style.css',
  '/service-worker.js',
  '/manifest.json',
  '/assets/logo-192.png',
  '/assets/logo-512.png',
  '/assets/screenshot-login.png',
  '/assets/screenshot-solicitacao.png'
];

// Instalando e pré-cacheando
self.addEventListener('install', event => {
  console.log('[SW] install');
  self.skipWaiting(); // ativa imediatamente (opcional)
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .catch(err => console.warn('[SW] erro pre-cache:', err))
  );
});

// Ativação: limpar caches antigos
self.addEventListener('activate', event => {
  console.log('[SW] activate');
  self.clients.claim(); // assumir páginas abertas
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(k => {
          if (k !== CACHE_NAME) {
            console.log('[SW] removendo cache antigo:', k);
            return caches.delete(k);
          }
        })
      )
    )
  );
});

// Estratégia de fetch:
// - requisições para páginas/HTML -> networkFirst (para manter dados atualizados)
// - assets estáticos (css, js, imagens) -> cacheFirst
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignorar requests cross-origin de terceiros (analytics, cdn) - opcional
  // if (url.origin !== location.origin) return;

  // HTML / navegação -> network first
  if (req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'))) {
    event.respondWith(
      fetch(req)
        .then(res => {
          // atualiza cache com a nova página
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  // Assets estáticos -> cache first
  if (req.method === 'GET') {
    event.respondWith(
      caches.match(req).then(cachedResponse => {
        if (cachedResponse) return cachedResponse;
        return fetch(req)
          .then(networkResponse => {
            // cachear imagens e css/js dinamicamente
            if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
            }
            return networkResponse;
          })
          .catch(() => {
            // fallback para imagens (opcional): retorna um placeholder se houver
            if (req.destination === 'image') return caches.match('/assets/logo-192.png');
            return new Response('', { status: 503, statusText: 'Offline' });
          });
      })
    );
  }
});
