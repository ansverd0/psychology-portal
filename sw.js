// Service Worker: РѕС„Р»Р°Р№РЅ-РїРµСЂРІС‹Р№ РґР»СЏ СЃС‚Р°С‚РёРєРё Рё Р±С‹СЃС‚СЂС‹Р№ С„РѕР»Р±РµРє РїСЂРё РјРµРґР»РµРЅРЅРѕР№ СЃРµС‚Рё.
// Р’Р°Р¶РЅРѕ: РїСЂРё РєР°Р¶РґРѕРј СЂРµР»РёР·Рµ РјРµРЅСЏР№С‚Рµ CACHE_NAME вЂ” СЌС‚Рѕ Рё РµСЃС‚СЊ РёРЅРІР°Р»РёРґР°С†РёСЏ РєСЌС€Р°.

const CACHE_NAME = 'psy-hub-v42';

// РџСѓС‚Рё РѕС‚РЅРѕСЃРёС‚РµР»СЊРЅС‹Рµ: СЂР°Р±РѕС‚Р°СЋС‚ Рё РІ РєРѕСЂРЅРµ РґРѕРјРµРЅР°, Рё РІ РїРѕРґРїР°РїРєРµ (GitHub Pages).
const ASSETS = [
  './',
  './index.html',
  './tests.html',
  './practice.html',
  './cards.html',
  './tickets.html',
  './sections.html',
  './library.html',
  './news.html',
  './offline.html',
  './privacy.html',
  './survey.html',
  './style.css',
  './js/vendor/supabase.js',
  './js/vendor/dompurify.min.js',
  './js/analytics.js',
  './js/vitals.js',
  './js/disciplines.js',
  './js/supabase-config.js',
  './js/ui-notify.js',
  './js/auth.js',
  './js/flashcards.js',
  './js/quiz.js',
  './js/practice.js',
  './js/sections-wiki.js',
  './js/tickets.js',
  './js/news-library.js',
  './js/bookmarks.js',
  './js/live-search.js',
  './js/client-log.js',
  './js/survey-data.js',
  './js/survey.js',
  './js/tracker.js'
];

const NAV_TIMEOUT = 2500;   // РЅР°РІРёРіР°С†РёСЏ: Р¶РґС‘Рј СЃРµС‚СЊ РЅРµ РґРѕР»СЊС€Рµ 2.5 c, РїРѕС‚РѕРј РѕС‚РґР°С‘Рј РєСЌС€
const ASSET_TIMEOUT = 8000; // СЃС‚Р°С‚РёРєР°: С‚Р°Р№РјР°СѓС‚ С„РѕРЅРѕРІРѕРіРѕ РѕР±РЅРѕРІР»РµРЅРёСЏ
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
  // РќРѕРІС‹Р№ РІРѕСЂРєРµСЂ Р°РєС‚РёРІРёСЂСѓРµС‚СЃСЏ СЃСЂР°Р·Сѓ, РЅРµ РґРѕР¶РёРґР°СЏСЃСЊ Р·Р°РєСЂС‹С‚РёСЏ РІСЃРµС… РІРєР»Р°РґРѕРє
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
              console.warn(`вљ пёЏ Р’РѕСЂРєРµСЂ РїСЂРѕРїСѓСЃС‚РёР» СЂРµСЃСѓСЂСЃ: ${asset}`, error.message);
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

  // РџРёС€РµРј С‚РѕР»СЊРєРѕ GET Рё С‚РѕР»СЊРєРѕ СЃРІРѕРё С„Р°Р№Р»С‹; Supabase Рё РІРЅРµС€РЅРёРµ CDN РЅРµ С‚СЂРѕРіР°РµРј
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

    // Р”РµСЂР¶РёРј РІРѕСЂРєРµСЂ Р¶РёРІС‹Рј, РїРѕРєР° РёРґС‘С‚ (РІРѕР·РјРѕР¶РЅРѕ, РјРµРґР»РµРЅРЅС‹Р№) Р·Р°РїСЂРѕСЃ
    event.waitUntil(network);
    event.respondWith(
      network.then(async (response) => {
        if (response) return response;
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        const fallback = await caches.match('./offline.html');
        if (fallback) return fallback;
        return new Response('РЎС‚СЂР°РЅРёС†Р° РЅРµРґРѕСЃС‚СѓРїРЅР° РѕС„Р»Р°Р№РЅ', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
    );
    return;
  }

  // РЎС‚Р°С‚РёРєР°: СЃСЂР°Р·Сѓ РёР· РєСЌС€Р°; РІ С„РѕРЅРµ вЂ” РѕР±РЅРѕРІР»РµРЅРёРµ РґР»СЏ СЃР»РµРґСѓСЋС‰РµРіРѕ РІРёР·РёС‚Р°
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
