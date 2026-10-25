# Psy-Education Hub

Учебный портал для студентов-психологов: конспекты билетов, тренажёр терминов, тесты, статьи, литература и новости.

- **Рабочий сайт:** https://ansverd0.github.io/psychology-portal/
- **Репозиторий:** https://github.com/ansverd0/psychology-portal
- **Supabase:** проект `lrjszannmammzzqotaro` (PostgreSQL + REST)
- **Документация:** [TECHCARD.md](TECHCARD.md) — устройство проекта, [TECH-ROADMAP.md](TECH-ROADMAP.md) — бэклог и правила, [docs/RUNBOOK.md](docs/RUNBOOK.md) — эксплуатация.

> Vercel-зеркало `psy-education.vercel.app` из России не открывается (обрыв TLS), для проверок используйте GitHub Pages или локальный сервер.

## Стек

- Чистый HTML5/CSS3/JS без сборщика.
- Supabase (Auth не используется; анонимный ключ — псевдоним).
- PWA: Service Worker, офлайн-кэш.
- Яндекс.Метрика подключается только после согласия на аналитику.
- Деплой: push в `master` → GitHub Actions → ветка `gh-pages` → GitHub Pages.

## Структура

```
index.html, tickets.html, sections.html, cards.html, tests.html, library.html, news.html, privacy.html
style.css
sw.js
js/                 # модули страниц + vendor (supabase-js, DOMPurify) + analytics.js
db/                 # SQL-миграции
scripts/            # бэкап, выполнение SQL, проверка прав, MCP-лаунчер
.github/workflows/  # pages.yml, backup.yml, monitor.yml
docs/RUNBOOK.md     # эксплуатация и восстановление
```

## Локальный запуск

```powershell
cd C:\psychology-portal
python -m http.server 8767 --bind 127.0.0.1
```

Открыть http://127.0.0.1:8767/index.html. Секреты не нужны: сайт читает Supabase по публичному publishable-ключу.

## Переменные окружения

Скопируйте `.env.example` в `.env` и заполните. `.env` в git не попадает.

| Переменная | Назначение |
|---|---|
| `SUPABASE_URL` | URL проекта |
| `SUPABASE_ANON_KEY` | публичный ключ (можно не задавать локально) |
| `SUPABASE_SERVICE_ROLE` | только для серверных скриптов, **никогда** не отдавать в браузер |
| `SUPABASE_PAT` | Management API: бэкапы и миграции |
| `SUPABASE_PROJECT_REF` | ref проекта |

Секреты для GitHub Actions: `SUPABASE_PAT`, `SUPABASE_PROJECT_REF`, `BACKUP_PASSPHRASE` (см. RUNBOOK).

## Скрипты

```powershell
node scripts/backup-db.mjs                  # дамп public-таблиц + снимок RLS/грантов
node scripts/db-exec.mjs db/file.sql --dry-run
node scripts/db-exec.mjs db/file.sql        # применить миграцию
node scripts/check-permissions.mjs          # 10 проверок прав anon
node scripts/mcp-supabase.mjs               # MCP-сервер с токеном из .env
```

## Деплой

```powershell
git add <файлы>
git commit -m "тип(область): что сделано"
git push origin master
```

GitHub Action `Sync gh-pages` зеркалит `master` в `gh-pages`, Pages пересобирается. Через 30–90 секунд проверьте `https://ansverd0.github.io/psychology-portal/sw.js` — версия `CACHE_NAME` должна измениться.

> При любом изменении файлов из списка `ASSETS` в `sw.js` поднимайте `CACHE_NAME`, иначе пользователи останутся на старом кэше.

## Безопасность

- RLS включён во всех 14 таблицах `public`.
- `anon` читает контент, создаёт профиль и пишет ответы методик; изменять/удалять контент не может.
- Контент из БД санитизируется (DOMPurify + экранирование).
- Секреты — только в `.env`; `.mcp.json` и `.env` в `.gitignore`.
- Политика данных и согласие: `privacy.html`.

## Тесты

Автотестов пока нет (задача `A-03`/`A-04` в TECH-ROADMAP). Минимальная ручная проверка:

- 1440 / 1024 / 768 / 390 px — нет горизонтального скролла;
- билеты, статьи, карточки, тесты, новости и литература отдают контент;
- вики-термины показывают подсказки;
- закладки сохраняются после перезагрузки;
- `node scripts/check-permissions.mjs` — 10/10 PASS.
