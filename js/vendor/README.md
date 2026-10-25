# Локальные библиотеки

Чтобы сайт не зависел от CDN (unpkg/jsDelivr) и не «висел» при медленной сети,
библиотеки лежат в репозитории. Версии и контрольные суммы зафиксированы в
`manifest.json` и проверяются командой `node scripts/check-vendor.mjs`.

| Файл | Версия | Источник | Лицензия | Размер | sha256 |
|---|---|---|---|---|---|
| `supabase.js` | 2.43.4 | https://unpkg.com/@supabase/supabase-js@2.43.4/dist/umd/supabase.js | Apache-2.0 | 106 011 Б | `a97c70db60533cf63ea432d5a08f4481ac09ec6d16e23190cd158d74a53afa2a` |
| `dompurify.min.js` | 3.0.11 | https://cdn.jsdelivr.net/npm/dompurify@3.0.11/dist/purify.min.js | Apache-2.0 / MPL-2.0 | 21 251 Б | `833a4bb2049353452eaac19dfe376324c0f11d33b008765f094bfadf4a5501f0` |

## Проверка

```powershell
node scripts/check-vendor.mjs        # сверяет файлы с manifest.json, код выхода 1 при расхождении
```

## Обновление

1. Скачать новую версию с указанного источника.
2. Заменить файл в этой папке.
3. Обновить версию/источник/лицензию в `manifest.json`, затем выполнить
   `node scripts/check-vendor.mjs --update` — он пересчитает размер и sha256.
4. Поднять `CACHE_NAME` в `sw.js` и проверить `tickets.html` / `sections.html`.

Расхождение хэша означает, что файл подменили или изменили без фиксации версии:
такой файл нельзя деплоить, пока источник не проверен.
