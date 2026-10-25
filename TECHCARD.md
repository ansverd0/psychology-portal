# TECHCARD — Техническая карта проекта Psy-Education Hub

> Одна актуальная техкарта. Все изменения вносятся сюда. Старые docx-версии удалены.
> Обновлено: 2026-10-20

---

## СТЕК

- **Frontend:** Чистый HTML5/CSS3/JS ES6 (без фреймворков)
- **Backend:** Supabase (PostgreSQL)
- **Аналитика:** Яндекс.Метрика (с Вебвизором)
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
├── sections.html           # Разделы психологии (лонтгриды)
├── library.html            # Каталог литературы
├── news.html               # История изменений
├── style.css               # Глобальные стили
├── sw.js                   # Service Worker (PWA кэш)
├── .gitignore
└── js/
    ├── supabase-config.js  # Ядро: клиент Supabase, кэш, оркестратор загрузки
    ├── auth.js             # Авторизация по анонимным ключам
    ├── flashcards.js       # Тренажёр терминов
    ├── quiz.js             # Интерактивные тесты
    ├── tickets.js          # Экзаменационные билеты
    ├── sections-wiki.js    # Разделы психологии + вики-эффект
    ├── news-library.js     # Новости + библиотека
    └── bookmarks.js        # НОВЫЙ: система закладок для tickets и sections
```

---

## БАЗА ДАННЫХ (Supabase)

| Таблица | Назначение | Ключевые поля |
|---------|------------|---------------|
| `users_profiles` | Анонимные ключи | `user_key` (UNIQUE), `tests_completed_count`, `essay_submitted` |
| `flashcards` | Карточки терминов | `term`, `definition`, `discipline_id` |
| `tests` | Вопросы тестов | `question`, `options` (массив), `correct_index`, `link_url`, `discipline_id` |
| `tickets` | Экзаменационные билеты | `number`, `title`, `recommend_time`, `plan`, `content`, `discipline_id` |
| `articles` | Статьи лонгридов | `title`, `content`, `discipline_id` |
| `glossary` | Глоссарий (вики-эффект) | `term`, `definition` |
| `library` | Каталог литературы | `id`, `title`, `author`, `annotation` |
| `news` | Ченджлог | `id`, `date`, `title`, `changes` (массив) |
| `ticket_library` | Билеты → литература | `ticket_id`, `book_id` |
| `version_control` | Версионирование | `version` |

---

## ИДЕНТИФИКАТОРЫ ДИСЦИПЛИН

| Дисциплина | discipline_id |
|------------|---------------|
| Общая психология | `general-psych` |
| Социальная психология | `social-psych` |
| Возрастная психология | `developmental-psych` |

---

## КРИТИЧЕСКИЕ ИСПРАВЛЕНИЯ (после сбоя ЦОД Яндекса)

1. **Метрика неблокируемая** — инициализация перенесена в `window.load` + `try/catch` (все 7 HTML-файлов). Если `mc.yandex.ru` недоступен — сайт продолжает работу.
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
- Яндекс.Метрика: `ym(112398882, 'userParams', { UserID: key })` при авторизации
- Режим «гость»: полный доступ к сайту без авторизации

---

## SERVICE WORKER

- Версия: `psy-hub-v1`
- Кэширует все HTML, CSS, JS, шрифты
- Supabase-запросы исключены из кэша
- Graceful degradation: при ошибке `cache.add()` — предупреждение, не падение
- Автообновление: `self.skipWaiting()` + очистка старых кэшей

---

## ИЗВЕСТНЫЕ ПРОБЛЕМЫ (см. «возникшие проблемы.docx»)

- tickets.html — не отображается БД (требует отладки запросов к Supabase)
- sections.html — сломано отображение
- ~~sections.html — не работает вики-эффект~~ ✅ ИСПРАВЛЕНО 2026-10-20
- Лишний `</main>` в index.html
- Переменные `currentCardIndex`, `currentTestIndex`, `score` — проверка на `let`
- Санитизация HTML при вставке из БД — DOMPurify подключён, но не везде используется
- `og:url` — заглушка `https://vercel.app` (исправляется динамически через `updateOpenGraphUrl`)
- Поиск по статьям — обработчик не реализован

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
- `.scrollable-container` — скроллящийся контейнер (max-height: 60vh)
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
git push

# Деплой
# Автоматический через Vercel при push в master
```

---

## ССЫЛКИ

- Сайт (рабочий, доступен из РФ): `https://ansverd0.github.io/psychology-portal/index.html`
- Зеркало Vercel (может быть недоступно из РФ): `https://psy-education.vercel.app/index.html`
- GitHub: `https://github.com/ansverd0/psychology-portal`
- Supabase: `https://supabase.com/dashboard/project/lrjszannmammzzqotaro`
