// Service Worker: офлайн-первый для статики и быстрый фолбек при медленной сети.
// Важно: при каждом релизе меняйте CACHE_NAME — это и есть инвалидация кэша.

const CACHE_NAME = 'psy-hub-v5';

// Пути относительные: работают и в корне домена, и в подпапке (GitHub Pages).
const ASSETS = [
  './',
  './index.html',
  './tests.html',
  './cards.html',
  './tickets.html',
  './sections.html',
  './library.html',
  './news.html',
  './style.css',
  './js/vendor/supabase.js',
  './js/vendor/dompurify.min.js',
  './js/supabase-config.js',
  './js/auth.js',
  './js/flashcards.js',
  './js/quiz.js',
  './js/sections-wiki.js',
  './js/tickets.js',
  './js/news-library.js',
  './js/bookmarks.js'
];

const NAV_TIMEOUT = 2500;   // навигация: ждём сеть не дольше 2.5 c, потом отдаём кэш
const ASSET_TIMEOUT = 8000; // статика: таймаут фонового обновления
const INSTALL_TIMEOUT = 8000;

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('network timeout')); }
    }, ms);

    fetch(request)
      .then((response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(response);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

self.addEventListener('install', (event) => {
  // Новый воркер активируется сразу, не дожидаясь закрытия всех вкладок
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        ASSETS.map((asset) =>
          fetchWithTimeout(new Request(asset, { cache: 'reload' }), INSTALL_TIMEOUT)
            .then((response) => {
              if (response && response.ok) return cache.put(asset, response);
              return null;
            })
            .catch((error) => {
              console.warn(`⚠️ Воркер пропустил ресурс: ${asset}`, error.message);
              return null;
            })
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) return caches.delete(key);
            return null;
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Пишем только GET и только свои файлы; Supabase и внешние CDN не трогаем
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    const network = fetchWithTimeout(request, NAV_TIMEOUT)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => null);

    // Держим воркер живым, пока идёт (возможно, медленный) запрос
    event.waitUntil(network);
    event.respondWith(
      network.then(async (response) => {
        if (response) return response;
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
        return new Response('Страница недоступна офлайн', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
    );
    return;
  }

  // Статика: сразу из кэша; в фоне — обновление для следующего визита
  const network = fetchWithTimeout(request, ASSET_TIMEOUT)
    .then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => null);

  event.waitUntil(network);
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return network.then((response) => response || new Response('', { status: 504 }));
    })
  );
});
