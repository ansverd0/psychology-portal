# TECHCARD — Техническая карта проекта Psy-Education Hub

> Одна актуальная техкарта. Все изменения вносятся сюда. Старые docx-версии удалены.
> Технический бэклог, приоритеты и правила для новых чатов: `TECH-ROADMAP.md`.
> Обновлено: 2026-10-26

---

## СТЕК

- **Frontend:** Чистый HTML5/CSS3/JS ES6 (без фреймворков)
- **Backend:** Supabase (PostgreSQL)
- **Аналитика:** Яндекс.Метрика — только после согласия; Вебвизор не пишет поля ввода
- **PWA:** Service Worker (sw.js)
- **Деплой:** GitHub Pages (ветка `gh-pages`, автосинхронизация из `master`), зеркало — Vercel
- **Сайт:** `https://ansverd0.github.io/psychology-portal/`

---

## СТРУКТУРА ПРОЕКТА

```
psychology-portal/
├── index.html              # Главная страница + модальное окно авторизации
├── tickets.html            # Экзаменационные билеты
├── cards.html              # Тренажёр терминов
├── tests.html              # Интерактивные тесты
├── sections.html           # Разделы психологии (лонгриды)
├── library.html            # Каталог литературы
├── news.html               # История изменений
├── privacy.html            # Политика обработки данных
├── offline.html            # Офлайн-страница PWA
├── style.css               # Глобальные стили
├── sw.js                   # Service Worker (PWA кэш)
├── README.md, docs/RUNBOOK.md
├── .github/workflows/      # pages.yml, backup.yml, monitor.yml
├── db/                     # миграции RLS и авто-версии
├── scripts/                # backup, db-exec, check-permissions, check-vendor, mcp
└── js/
    ├── supabase-config.js  # Ядро: клиент, PAGE_LOADERS, кэш, SW
    ├── analytics.js        # Метрика после согласия, защита полей, PsyAnalytics API
    ├── vitals.js           # Web Vitals: LCP/CLS/INP → localStorage + Метрика
    ├── auth.js             # Авторизация по анонимным ключам
    ├── flashcards.js       # Тренажёр терминов
    ├── quiz.js             # Интерактивные тесты
    ├── tickets.js          # Экзаменационные билеты
    ├── sections-wiki.js    # Разделы психологии + вики-эффект
    ├── news-library.js     # Новости + библиотека
    ├── bookmarks.js        # Система закладок для tickets и sections
    └── vendor/             # supabase-js 2.43.4, DOMPurify 3.0.11, manifest.json (sha256)
```

---

## БАЗА ДАННЫХ (Supabase)

| Таблица | Назначение | Ключевые поля |
|---------|------------|---------------|
| `users_profiles` | Анонимные ключи | `user_key` (UNIQUE), `created_at`; поля прогресса — в R-05 |
| `flashcards` | Карточки терминов | `term`, `definition`, `discipline_id` |
| `tests` | Вопросы тестов | `question`, `options` (массив), `correct_index`, `link_url`, `discipline_id` |
| `tickets` | Экзаменационные билеты | `number`, `title`, `recommend_time`, `plan`, `content`, `discipline_id` |
| `articles` | Статьи лонгридов | `title`, `content`, `discipline_id` |
| `glossary` | Глоссарий (вики-эффект) | `term`, `definition` |
| `library` | Каталог литературы | `id`, `title`, `author`, `annotation` |
| `news` | Ченджлог | `id`, `date`, `title`, `changes` (массив) |
| `ticket_library` | Билеты → литература | `ticket_id`, `book_id` |
| `version_control` | Автоверсия контента (триггеры на контентных таблицах) | `version` |

---

## ИДЕНТИФИКАТОРЫ ДИСЦИПЛИН

| Дисциплина | discipline_id |
|------------|---------------|
| Общая психология | `general-psych` |
| Социальная психология | `social-psych` |
| Возрастная психология | `developmental-psych` |

---

## КРИТИЧЕСКИЕ ИСПРАВЛЕНИЯ (после сбоя ЦОД Яндекса)

1. **Метрика неблокируемая** — подключается из `js/analytics.js` только после согласия, внутри `try/catch`. Если `mc.yandex.ru` недоступен — сайт продолжает работу.
2. **Supabase fallback** — `createClient` обернут в `try/catch`. Если CDN `unpkg.com` недоступен — `supabaseClient = null` → `initApplicationHub` сразу уходит в `activateLocalDatabaseFallback()` (localStorage snapshot).
3. **Auth не блокирует** — модальное окно больше не показывается автоматически. Кнопка «Продолжить как гость» всегда доступна. Если Supabase недоступен — показывается alert, сайт работает без авторизации.
4. **`js/auth.js` в кэше SW** — добавлен в `sw.js` ASSETS.

---

## ВИКИ-ЭФФЕКТ (Глоссарий)

- Механизм: все термины из `glossary` сортируются по длине (от длинных к коротким), экранируются спецсимволы, собираются в одно мега-регулярное выражение: `/\b(Термин1|Термин2|КороткийТермин)\b/gi`
- Замена за один проход по тексту — O(N) вместо O(N×M)
- Защита от вложенных слов: сортировка по длине предотвращает разрушение
- Используется в `sections-wiki.js` функция `showSectionContent()`

---

## СИСТЕМА АВТОРИЗАЦИИ

- Генерация ключа: «цвет-объект-число» (например, `зеленый-кедр-77`)
- Сохранение: `localStorage` + INSERT в `users_profiles` (Supabase)
- Кросс-девайс: ввод старого ключа → SELECT в Supabase → восстановление в localStorage
- Яндекс.Метрика: `ym(112398882, 'userParams', { UserID: key })` при авторизации (после согласия на аналитику)
- Режим «гость»: полный доступ к сайту без авторизации

---

## ЗАГРУЗКА ДАННЫХ

- `PAGE_LOADERS` в `js/supabase-config.js`: каждая страница запрашивает только свои таблицы.
  - `index` — без Supabase (только авторизация);
  - `cards` — `flashcards`; `tests` — `tests`; `tickets` — `tickets` + `ticket_library` + `library`;
  - `sections` — `articles` + `glossary`; `library` — `library`; `news` — `news`.
- Кэш страницы: `hub_page_cache_<page>` и `hub_page_version_<page>`; старый общий `hub_database_snapshot` автоматически мигрирует при первом визите.
- Версия контента (`version_control`) обновляется триггерами в БД, вручную не бампается.

---

## SERVICE WORKER

- Версия: `psy-hub-v14`
- Стратегия: cache-first для статики, network-first для навигации с таймаутом 2.5 с
- Кэширует все HTML, CSS, JS, шрифты; Supabase-запросы исключены
- В `ASSETS` также `js/vitals.js` (добавлен в v13)
- Фолбек навигации — `offline.html`
- Ошибка `cache.add()` не валит установку
- Обновление: `self.skipWaiting()` + очистка старых кэшей; при `controllerchange` показывается баннер «Доступна новая версия» без принудительного reload

---

## WEB VITALS

- Модуль `js/vitals.js` (без зависимостей) на всех страницах, кроме служебных исключений нет — включён и в `offline.html`.
- Метрики: **LCP** (`largest-contentful-paint`), **CLS** (сессионные окна по 1 с, максимум 5 с), **INP** (Event Timing, `durationThreshold: 40`), плюс **FCP** и **TTFB**.
- Отчёт формируется один раз на `pagehide`/`visibilitychange → hidden`.
- Свой лог: `localStorage['hub_web_vitals']` — последние 20 загрузок (страница, метрики, viewport, тип соединения).
- Метрика: только после согласия, через `window.PsyAnalytics.trackVitals()` (`params` + цель `web_vitals`).
- Ручная проверка в консоли: `hubVitals.latest()`, `hubVitals.log()`, `hubVitals.clear()`.

---

## БЕЗОПАСНОСТЬ: CSP

- На всех 9 страницах `<meta http-equiv="Content-Security-Policy">` сразу после `viewport`.
- Политика: `default-src 'self'`; скрипты — `'self' 'unsafe-inline'` + `https://mc.yandex.ru`; стили — `'self' 'unsafe-inline'` (inline-атрибуты в HTML); изображения — `'self' data: https://mc.yandex.ru`; `connect-src` — Supabase и Метрика; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
- `Referrer-Policy` — `<meta name="referrer" content="strict-origin-when-cross-origin">`.
- Ограничение: GitHub Pages не отдаёт HTTP-заголовки, поэтому `X-Content-Type-Options`, `frame-ancestors` и HSTS задать нельзя; `'unsafe-inline'` нужен из-за inline-обработчиков `onclick` (снять в `U-01`).
- Проверено в Chrome: CSP-нарушений нет на 1440/1024/768/390 px; Метрика после согласия грузится без блокировок.

---

## VENDOR-БИБЛИОТЕКИ

- `js/vendor/supabase.js` — supabase-js 2.43.4, `js/vendor/dompurify.min.js` — DOMPurify 3.0.11; лежат локально, без CDN.
- Версии, размеры и sha256 — `js/vendor/manifest.json`.
- Проверка: `node scripts/check-vendor.mjs` (код 1 при расхождении).
- После замены файла: `node scripts/check-vendor.mjs --update`, затем поднять `CACHE_NAME` в `sw.js`.

---

## ИЗВЕСТНЫЕ ПРОБЛЕМЫ

Актуальный бэклог и приоритеты — в `TECH-ROADMAP.md`. В этом файле оставлены только подтверждённые пункты:

- HTTP-заголовки безопасности (`X-Content-Type-Options`, HSTS, `frame-ancestors`) на GitHub Pages недоступны — работает только meta-CSP (`S-04`);
- нет unit/E2E-тестов и проверок в CI (`A-03`–`A-05`);
- исследовательский модуль (события, срез, эссе, выгрузка) не реализован (`R-*`);
- нет админки, контент правится через Table Editor (`O-01`).

---

## ИНТЕРФЕЙС (см. «работа с интерфейсом.docx»)

### Редизайн 2026-10-20 (выполнено)

#### Структура файлов
```
js/
├── bookmarks.js        # НОВЫЙ: система закладок (localStorage)
```

#### CSS-компоненты (style.css)
- `.tri-column-layout` — 3 колонки (280px | 1fr | 260px) для tickets/sections
- `.content-with-sidebar` — 2 колонки (240px | 1fr) для cards/tests
- `.discipline-sidebar` — сайдбар с вертикальным списком дисциплин
- `.bookmarks-panel` — панель закладок справа (ПК)
- `.limited-tiles` — плитки с лимитом 3 строк
- `.limited-articles` — статьи с лимитом 5 строк
- `.bookmark-star-btn` — кнопка-звёздочка закладки

#### Закладки (bookmarks.js)
- Хранение: `localStorage` ключ `hub_bookmarks`
- Типы: `'ticket'` (билеты), `'article'` (статьи)
- API: `getBookmarks()`, `addBookmark()`, `removeBookmark()`, `toggleBookmark()`
- Рендер: `renderBookmarksPanel()`, `updateBookmarkStar()`

### tickets.html
- ПК: `.tri-column-layout` — слева навигация, центр конспекты, справа закладки
- Мобильные: `.limited-tiles` (3 строки), `.limited-articles` (5 строк), автопрокрутка

### sections.html
- ПК: `.tri-column-layout` — слева навигация, центр статьи, справа закладки
- Мобильные: `.limited-tiles`, `.limited-articles`, автопрокрутка
- Вики-эффект: исправлен порядок (сначала санитизация, потом wiki-теги)

### cards.html / tests.html
- ПК: `.content-with-sidebar` — слева сайдбар дисциплин, справа контент
- Мобильные: `.limited-tiles` для вертикальной прокрутки

---

## КОМАНДЫ (см. «команды.docx»)

```powershell
# Сохранение изменений
git add .
git commit -m "описание изменений"
git push origin master

# Деплой
# Автоматический: GitHub Actions зеркалит master в gh-pages → GitHub Pages
```

---

## ССЫЛКИ

- Сайт (рабочий, доступен из РФ): `https://ansverd0.github.io/psychology-portal/index.html`
- Зеркало Vercel (может быть недоступно из РФ): `https://psy-education.vercel.app/index.html`
- GitHub: `https://github.com/ansverd0/psychology-portal`
- Supabase: `https://supabase.com/dashboard/project/lrjszannmammzzqotaro`
