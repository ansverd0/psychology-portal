# Локальные библиотеки

Чтобы сайт не зависел от CDN (unpkg/jsDelivr) и не «висел» при медленной сети,
библиотеки лежат в репозитории:

| Файл | Версия | Источник | Лицензия |
|---|---|---|---|
| `supabase.js` | 2.43.4 | https://unpkg.com/@supabase/supabase-js@2.43.4/dist/umd/supabase.js | Apache-2.0 |
| `dompurify.min.js` | 3.0.11 | https://cdn.jsdelivr.net/npm/dompurify@3.0.11/dist/purify.min.js | Apache-2.0 / MPL-2.0 |

Обновление: скачать новую версию, заменить файл, поднять `CACHE_NAME` в `sw.js`
и проверить страницы `tickets.html` / `sections.html`.
