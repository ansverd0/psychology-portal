const CACHE_NAME = 'psy-hub-v1';
const ASSETS = [
  '/',
  '/index.html', // Если файл называется иначе (например main.html), замени или удали строку
  '/tests.html',
  '/cards.html',
  '/tickets.html',
  '/sections.html',
  '/library.html',
  '/news.html',
  '/style.css', // Проверь путь! Если лежит в папке: '/css/style.css'
  '/js/supabase-config.js',
  '/js/flashcards.js',
  '/js/quiz.js',
  '/js/sections-wiki.js',
  '/js/tickets.js',
  '/js/news-library.js'
];

// Безопасная поштучная установка ресурсов в кэш (Защита от падения addAll при 404)
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const cachePromises = ASSETS.map((asset) => {
        return cache.add(asset).catch((err) => {
          console.warn(`⚠️ Воркер пропустил ресурс (нет файла на сервере): ${asset}`, err.message);
        });
      });
      return Promise.all(cachePromises);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('supabase.co')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Кэшируем только успешные GET-запросы от приложения
        if (!res || res.status !== 200 || res.type !== 'basic' || e.request.method !== 'GET') {
          return res;
        }
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, resClone);
        });
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
