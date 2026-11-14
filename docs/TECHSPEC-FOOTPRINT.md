# Техпроект: оценка цифрового следа

> Версия 1.0 от 14.11.2026. До старта окна сбора (17.11.2026) документ можно менять;
> после старта — только новой версией с датой, как `METHOD-FREEZE`.
> Основание: [METHOD-FREEZE.md](METHOD-FREEZE.md) §5, §5.1, §9; [PLAN-RESEARCH.md](PLAN-RESEARCH.md)
> шаги D и F. Факты о базе — на 14.11.2026.

---

## 1. Цель

Сделать цифровой след пригодным для анализа: каждая метрика §5 считается из
журнала `events` воспроизводимо, одним скриптом, с известными правилами очистки;
выгрузка — одна строка на студента и словарь переменных; данные окна 17.11–29.01
не содержат дублей, тестовых ключей и недосчитанного времени.

**Не входит в этот техпроект:** кластеризация и статистика (шаг F плана, февраль),
эссе и их кодирование (R-07), админ-панель (R-10), правки интерфейса.

---

## 2. Факты на 14.11.2026

| Показатель | Значение |
|---|---|
| Профилей / полных пар ШАМ+ССПМ | 59 / 53 |
| Событий в `events` | 8840, из них 7636 — тестовый ключ `белый-кедр-73` |
| Реальных ключей с событиями | 54 (44 с просмотром, 42 с записанным временем, 12 — только вехи) |
| Реальное время | 82,0 мин сырых → 79,7 мин после дедупликации |
| Дубли | 273 группы с одинаковыми `(user_key, session_id, page, event, ts)`, до 40 копий; 1204 → 1007 строк у реальных ключей |
| `page_leave` > 30 мин | 3 (max 68,5 мин) — формула требует cap |
| `page_leave` < 1 с | 156 |
| `deadlines` / `session_essays` | 0 / 0 |
| `quiz_results` / `practice_attempts` | 1 / 1 (попытка тестового ключа) |

Причины дефектов: ретрай батча после таймаута повторно вставляет уже записанные
события (у `log_events` нет идемпотентности); dwell считается на страницу, а не на
статью; тестовый ключ не помечен в базе. Вывод: **до 17.11 нужны миграция и
инструментация, а не только скрипт анализа.**

---

## 3. Архитектура

```
Браузер                          Supabase                       Скрипты (Node)
────────                         ────────                       ──────────────
tracker.js  ──log_events──▶  events (event_id, meta)  ──▶  export-research.mjs
  page_view/leave,                ▲                            ├─ dedupe + cap
  tab_switch, article_leave       │                            ├─ metrics.mjs
sections-wiki.js ────────────────┘                            ├─ users.csv
live-search.js  search                                        ├─ events.csv
quiz.js         test_start                                     ├─ essays.csv
bookmarks.js    bookmark                                      ├─ funnel.csv
practice.js     task_* + discipline                           └─ dictionary.md
```

Принципы:

1. **Сырые данные не переписываем.** Очистка (дедуп, cap, фильтры) — на выгрузке.
2. **Дедуп на записи и на выгрузке.** `event_id` защищает будущее, отпечаток
   `(user_key, session_id, page, event, ts)` — уже собранное.
3. **Одна реализация формул.** Все метрики — в `scripts/metrics.mjs`, отчёт и
   выгрузка используют только её.
4. **Тестовые ключи помечены в базе**, а не списком в каждом запросе.
5. **Атрибуция по статьям и дисциплинам** — из `meta`, а не догадками по времени.

---

## 4. Схема данных (миграция `db/2026-11-15_footprint_v1.sql`)

```sql
alter table users_profiles add column is_test boolean not null default false;
create index users_profiles_is_test_idx on users_profiles (user_key) where is_test;

alter table events add column event_id text
  check (event_id is null or event_id ~ '^[a-zA-Z0-9-]{8,64}$');
create unique index events_user_event_id_uidx on events (user_key, event_id);
```

`log_events` v2: принимает `event_id` из каждого события, вставляет с
`on conflict (user_key, event_id) do nothing`, возвращает число реально вставленных
строк. Старые клиенты без `event_id` работают как раньше (NULL не конфликтует).
Тестовые ключи (`белый-кедр-73`, `тестовый-ключ-11`, `test-key-11`) помечаются
`is_test = true`; остальные — вручную, если появятся.

Почему не чистим дубли в таблице: уникальный индекс на существующие дубли не
встанет, а удаление строк — необратимая операция на живых данных. Дубли остаются,
выгрузка их схлопывает; новые не появляются.

---

## 5. Инструментация

| Событие | Где | `meta` | Зачем |
|---|---|---|---|
| `page_view` | tracker.js | `referrer: 0/1` | вход на страницу |
| `page_leave` | tracker.js | — (dwell, scroll) | время и прокрутка страницы |
| `tab_switch` | tracker.js | `away_ms` | переключения вкладки |
| `article_open` | sections-wiki.js | `article_id`, `discipline`, `title` (80) | открытие статьи |
| `article_leave` | sections-wiki.js | `article_id`, `discipline`, `dwell_ms`, `scroll_pct` | время и дочитывание статьи |
| `ticket_open` | tickets.js | `number`, `discipline` | обращение к билету |
| `test_start` | quiz.js | `discipline`, `total`, `limit` | начал отвечать |
| `test_complete` | quiz.js | `discipline`, `score`, `total` | закончил тест |
| `card_flip` | flashcards.js | `discipline` | работа с карточками |
| `search` | live-search.js | `chars`, `results`, `category` | поиск как обращение за помощью |
| `bookmark` | bookmarks.js | `action` (add/remove), `kind`, `folder` | возврат к материалу |
| `task_open` / `task_submit` / `self_check` | practice.js | + `discipline` | верхние уровни Блума |
| вехи опроса | survey.js | — | воронка |

**Статья: как считается сегмент.** В `sections-wiki.js` открытие статьи запускает
сегмент: `openedAt`, `awayMs` (время скрытой вкладки), `maxScroll`. Закрытие —
при переходе к другой статье и на `pagehide`; сегмент уходит одним `article_leave`
с видимым временем (`now − openedAt − awayMs`) и максимумом прокрутки статьи
(доля высоты `.content-text`, побывавшая во вьюпорте). Сегменты не двоятся:
после отправки состояние обнуляется. Если `PsyTracker` нет — молча ничего не пишем.

**`article_id`.** Стабильный: `articles.id` (uuid) из базы; в кэше старой версии
id может не быть — fallback `discipline_id + '|' + title`, он же ключ уникальности
в БД. Название статьи в meta остаётся для читаемости, но группировка — по id.

**Практикум.** В `meta` добавляется `discipline` (поле есть в `practice_tasks`), чтобы
`prep_start_days` и `deadline_share` могли привязать задание к дисциплине.

**Почему `test_start` — первое отвеченное задание, а не загрузка страницы:**
`startQuizMode(allQuestions)` вызывается при открытии `tests.html`, и событие на
загрузке считало бы «началом» каждый заход. Флаг сбрасывается при смене теста.

---

## 6. Метрики

Все метрики считаются по событиям окна, после дедупа, с часовым поясом
`Europe/Moscow`. `ts` в базе — UTC.

| Метрика | Формула | Правила и null |
|---|---|---|
| `total_time_min` | Σ `dwell_ms` по `page_leave`, только учебные страницы (`tickets`, `sections`, `tests`, `cards`, `practice`), каждый сегмент ≤ 30 мин | 0, если нет сегментов |
| `time_all_min` | то же по всем страницам | диагностика |
| `sessions_count` | число сессий: разрыв между соседними событиями > 30 мин | 0, если нет событий |
| `avg_session_min` | среднее по сессиям от суммы учебного dwell в сессии | null, если сессий 0 |
| `active_days` | число локальных календарных дат с событиями | 0 |
| `window_days` | от локальной даты первого события до конца окна включительно | задаётся `--window-end` |
| `regularity` | `active_days / window_days`, 0…1 | null, если `window_days = 0` |
| `tab_switch_index` | `tab_switch` / (`total_time_min` / 10) | null, если учебного времени < 1 мин |
| `tests_completed` | число строк `quiz_results` | 0 |
| `theory_depth` | число `article_id`, у которых Σ `article_leave.dwell` ≥ 60 с | 0; легаси без `article_id` не считается |
| `scroll_avg` | среднее по статьям от максимума `article_leave.scroll_pct` | null, если статей нет |
| `scroll_avg_page` | среднее `page_leave.scroll_pct` по учебным страницам | легаси-фолбэк |
| `deadline_share` | доля учебного времени в `[due − 3 дня; due]` от всего учебного времени | null, если дедлайнов нет |
| `prep_start_days` | дни от первого содержательного события по дисциплине до её дедлайна | null, если дедлайнов нет |
| `prep_start_days_5min` | то же, но первый раз, когда в сессии появилась дисциплина и набралось ≥ 5 мин учёбы | приближение, см. §11 |
| `practice_users` | уникальные `user_key` в `practice_attempts` | 0 |
| `practice_attempts` | число строк `practice_attempts` | 0 |
| `level_mix` | доля попыток по `meta.level` (`apply/analyze/evaluate/create`) | — |
| `higher_order_share` | учебное время на `page='practice'` / `total_time_min` | 0 |
| `self_score_avg` | среднее `self_score / max_score` по open-попыткам | null |
| `return_after_low_score` | `self_check` с `self_score/max_score < 0.5` → `task_open`/`task_submit` той же задачи в течение 30 мин | 0 |

**Содержательное событие по дисциплине** — `article_open`, `ticket_open`,
`test_complete`, `task_open` с `meta.discipline`, равным дисциплине дедлайна.
Дедлайн студента — ближайший `due_at` его группы (если группы нет — курса).

**Пилот и пре-окно.** Основные метрики считаются с `--from 2026-11-17` (по
умолчанию). Данные до окна остаются в `events.csv`, но в `users.csv` не входят;
для проверки конвейера есть `--from` любой даты.

---

## 7. Выгрузка

`node scripts/export-research.mjs [--out <папка>] [--from 2026-11-17]
[--window-end 2027-01-29] [--include-test] [--no-write] [--json]`

Пишет в `exports/<ГГГГ-ММ-ДД_ЧЧММ>/`:

| Файл | Содержимое |
|---|---|
| `users.csv` | одна строка = студент: ключ, группа, курс, шкалы ШАМ/ССПМ, все метрики §6, коды эссе |
| `events.csv` | дедуплицированные события окна (для пересчёта и проверки) |
| `essays.csv` | тексты и коды эссе (когда появятся) |
| `practice.csv` | попытки практикума |
| `funnel.csv` | воронка опроса: уникальные пользователи по вехам и волнам |
| `dictionary.md` | описание каждой колонки и правил |
| `meta.json` | окно, дата выгрузки, версия правил, число строк, quality-гейты |

Правила: `;` не используем — CSV с запятой, десятичная точка, UTF-8 с BOM,
поля в кавычках при необходимости. `users.csv` — по одному студенту, у которого
есть пара методик или события окна; `is_test` исключены, если не `--include-test`.

**Quality-гейты** (печатаются и пишутся в `meta.json`):

- доля событий с `event_id` (после выкатки — 100%);
- дубли после дедупа (должно быть 0);
- сегменты > 30 мин (сколько подрезано);
- ключи без единого `page_leave` (воронка покажет, сколько);
- ключи только с вехами опроса;
- покрытие: доля студентов с ≥ 1 сессией и `window_days ≥ 14` (порог кластеризации §6).

---

## 8. Тесты и приёмка

`node scripts/metrics.mjs --selftest` — фикстуры без сети: дедуп по `event_id`
и отпечатку, сессии на 29/31 мин, cap 30 мин, фильтр учебных страниц, полночь
Москвы, `regularity`, `tab_switch_index`, порог 60 с и сумма сегментов статьи,
`prep_start_days`/`deadline_share` на синтетических дедлайнах, исключение `is_test`.

`node scripts/check-research.mjs` — живая проверка: повторный батч с теми же
`event_id` не создаёт строк; `is_test` по умолчанию `false`; старый батч без
`event_id` принимается.

Приёмка:

1. `metrics --selftest` — все проверки PASS.
2. `check-research` — 44+/44+ PASS.
3. `export-research --no-write` на живой базе — строки есть, тестовый ключ
   исключён, дублей 0, в `meta.json` окно и версия правил.
4. `check:ui` — без регрессий (сценарии `sections` и `tickets` проверяют открытие
   статей; новые события не должны ломать интерфейс).
5. Ручной проход: открыть статью, переключить, закрыть вкладку — в `events`
   появились `article_open`/`article_leave` с `article_id`, dwell > 0.

---

## 9. Порядок выкатки и откат

1. `node scripts/backup-db.mjs --out backups/<stamp>_db` — дамп всех таблиц.
2. `node scripts/db-exec.mjs db/2026-11-15_footprint_v1.sql --dry-run`.
3. Применить миграцию (без dry-run), затем `check-research`.
4. Выкатить JS (`tracker.js`, `sections-wiki.js`, `supabase-config.js`, `live-search.js`,
   `bookmarks.js`, `quiz.js`, `practice.js`), поднять `CACHE_NAME` до `v39`.
5. Прогнать `export-research --no-write`, `check:ui`, ручной проход.
6. Коммит после каждого шага; тег/запись в `TECH-ROADMAP` §журнал.

Откат: JS — `git revert` + поднять версию кэша; БД — колонки аддитивные, старый
`log_events` возвращается применением `db/2026-11-01_research_schema.sql` (функция
перезаписывается). Удалять `event_id`/`is_test` не нужно: старый код их игнорирует.

---

## 10. Файлы

| Файл | Роль |
|---|---|
| `db/2026-11-15_footprint_v1.sql` | миграция |
| `js/tracker.js` | `event_id`, `flush(keepalive)` |
| `js/sections-wiki.js` | сегменты статей |
| `js/supabase-config.js` | `articles.id` в данных |
| `js/live-search.js`, `js/bookmarks.js`, `js/quiz.js`, `js/practice.js` | новые события/meta |
| `scripts/metrics.mjs` | формулы + selftest |
| `scripts/export-research.mjs` | выгрузка |
| `scripts/check-research.mjs` | живая проверка дедупа |

---

## 11. Решения, которые надо подтвердить

1. **Учебные страницы.** Предлагаю `tickets, sections, tests, cards, practice`;
   `index`, `news`, `library`, `survey` — вне `total_time_min`. Это меняет
   формулировку §5 («Σ по page_leave»), поэтому фиксируется как METHOD-FREEZE 1.1.
2. **`prep_start_days`.** В §7 сказано «≥ 5 мин за раз», но время в журнале не
   привязано к дисциплине. Предлагаю две колонки: основную `prep_start_days`
   (первое содержательное событие) и приближение `prep_start_days_5min`
   (сессия с дисциплиной и ≥ 5 мин учёбы). Иначе метрика не считается вообще.
3. **Дедлайн при нескольких экзаменах.** Берём ближайший `due_at` группы;
   `deadline_share` — по трём дням до него. Альтернатива — считать по каждому
   экзамену и усреднять; дороже и менее интерпретируемо.
4. **Практикум.** Добавление `discipline` в `meta` — изменение §5.1; делать сейчас,
   до старта сбора.

---

## 12. Статус реализации (15.11.2026)

Реализовано и проверено:

| Что | Чем проверено |
|---|---|
| Миграция `db/2026-11-15_footprint_v1.sql` применена: `is_test`, `event_id`, `log_events` v2 | `information_schema` + `pg_get_functiondef`; `check-research` — **44/44** |
| Дедуп: повторный батч с теми же `event_id` возвращает 0, старый клиент без id принимается | `check-research`: пункты 20–24 |
| Тестовый ключ `белый-кедр-73` помечен, `survey-report` его исключает (52 пары вместо 53) | `survey-report --selftest` — **21/21**, живой отчёт |
| `article_open`/`article_leave` с `article_id`, dwell и scroll; скрытая вкладка вычитается | Headless Chrome: очередь и батчи — 2 открытия и 1 закрытие с id; повторный вход из кэша пишет открытие |
| Формулы §6 в `scripts/metrics.mjs` (дедуп, сессии, cap, МСК, статьи, дедлайны, практикум) | `npm run test:metrics` — **25/25** |
| Выгрузка `export-research.mjs`: 54 студента, 1007 событий после дедупа, тестовый ключ исключён | прогон на пилоте 01–14.11; `users.csv` — 54 строки, `meta.json` с качеством |
| UI не сломан | `npm run check:ui` — **209/209** |

Найденный и закрытый дефект: `tracker.start()` читал очередь с диска и затирал
события, пришедшие до `DOMContentLoaded` (первое открытие статьи у пользователя
с кэшем). Теперь ранняя очередь сливается с сохранённой; проверено повторным
входом из кэша.

Осталось до 17.11:

1. **Выкатить JS на живой сайт** — push в `master` (GitHub Pages). Локально всё
   зелёное, но на `ansverd0.github.io` пока старый `tracker.js`.
2. Проверить на живом сайте по одному реальному ключу: `article_open`/`article_leave`
   с `article_id` и `event_id` (в `meta.json` выгрузки `event_id_share` должен
   пойти вверх с 0).
3. В январе занести `deadlines` по группам — иначе `deadline_share` и
   `prep_start_days` останутся `null`.

Дальше по плану: сбор 17.11–29.01, в феврале — `export-research.mjs`, затем
кластеризация и статистика (шаг F плана).
