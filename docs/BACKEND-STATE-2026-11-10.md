# Бэкенд: состояние и решения, 10.11.2026

Документ фиксирует, что сделано в чате «бэкенд» и какие решения принял владелец. Заменяет собой переписку:
если через месяц непонятно, почему в `articles` есть `source`, а в реестре 27 дисциплин — ответ здесь.

## 1. Бэкапы восстановлены (P0 закрыт)

| Что | Доказательство |
|---|---|
| Причина 9 падений | лог запуска 42801555895, шаг «Dump and encrypt»: `Error: HTTP 401: {"message":"Invalid access token"}` — в GitHub Secret `SUPABASE_PAT` лежал отозванный токен (создан 25.10, с тех пор не менялся) |
| Секреты | `SUPABASE_PAT` и `SUPABASE_PROJECT_REF` обновлены 10.11.2026 19:29 UTC; `BACKUP_PASSPHRASE` не трогали |
| Зелёные запуски | 42885777053 (до миграций) и 42892821932 (после миграций) — `workflow_dispatch`, оба success |
| Артефакт проверен | `db-backup-42885777053`, 913 292 байта; `gpg --decrypt` с паролем из `backuppassphrase.txt` → exit 0; 19 JSON + `_security_before.json`, 8722 строки |
| Локальные дампы | `backups/2026-11-10-19-30_db` (8722 строки) и `backups/2026-11-10-20-06_db` (перед миграциями) |

`events` вырос с 6055 (аудит 10.11) до 6122 — прирост, не расхождение.

Ловушка в `backup.yml` («нет секретов → warning + `exit 0`») убрана: теперь `exit 1`.
`monitor.yml` раз в 30 минут проверяет, что последний успешный `backup.yml` не старше 26 часов.

## 2. PAT: новый, ротация не нужна (решение владельца)

Владелец подтвердил 10.11.2026: токен в `.env` — уже перевыпущенный, факт засветки в переписке
принят. Повторная ротация не планируется.

- токен проверен: `GET /v1/projects/lrjszannmammzzqotaro` → 200;
- он же лежит в GitHub Secrets, поэтому бэкап и работает;
- порядок на случай компрометации — `docs/RUNBOOK.md` §4.

## 3. Миграции применены (10.11.2026, по просьбе владельца)

Все три файла — `begin; … commit;`, сначала `--dry-run` (HTTP 201), перед накатом снят дамп
`backups/2026-11-10-20-06_db`. После каждой — `notify pgrst, 'reload schema'`.

| Файл | Что делает | Проверка после наката |
|---|---|---|
| `db/2026-11-10_articles_source.sql` | колонка `articles.source text` + комментарий | `information_schema.columns` → 6-я колонка `source text`, nullable |
| `db/2026-11-10_cleanup_alias_disciplines.sql` | удаляет 3 мёртвые строки `disciplines` (`general-exam`, `social-exam`, `developmental-exam`); удаляет дубль индекса `ticket_library_pair_key` (тот же `(ticket_id, book_id)`, что у первичного ключа) | `select count(*) from disciplines` → **27**, `like '%-exam'` → 0; у `ticket_library` остался один индекс `ticket_library_pkey`; связок по-прежнему 377 |
| `db/2026-11-10_quiz_results_rpc_only.sql` | снимает политику `quiz insert` (прямой INSERT от `anon` с `with check (true)`) | `pg_policy` по `quiz_results` → 0 политик; запись идёт только через RPC `log_quiz_result` |

Удалять псевдонимы было безопасно: 0 строк во всех контентных таблицах и в `deadlines`, внешние ключи
`ON DELETE CASCADE` — каскадировать нечего. В реестре `materials/disciplines.json` псевдонимы
остались как `aliases` — они нужны импорту, чтобы файлы с `general-exam` продолжали попадать
в канонические дисциплины.

После DDL клиенты один раз перезагрузились: `version_control.version` сменилась на `ed25dae8…`
(её подняли триггеры).

## 4. Что доделано в коде (не схема)

| Что | Где | Проверка |
|---|---|---|
| `source` больше не теряется при импорте | `scripts/content-import.mjs`: `validateArticle` возвращает `source` (тип строка, ≤500 символов), `DB_FIELDS.articles` его пишет | round-trip: экспорт `stress-psych` → `source="__TEST_SOURCE_10_11__"` → `--apply` → в БД поле появилось у 1 статьи → повторный импорт исходного файла вернул `null`. В БД снова 0 непустых `source`, 196 статей |
| Выгрузка по одной дисциплине | `--export <dir> --discipline <id>`; неизвестный id → exit 1; `library` выгружается целиком (таблица без дисциплины) с пометкой в логе | `--discipline general-psych` → articles 22, tickets 28, flashcards 65, tests 30, library 20 |
| Результат теста действительно сохраняется | `js/quiz.js`: `saveQuizResult()` в `showResults()` зовёт `rpc/log_quiz_result`, только если есть `research_user_key`; ошибки сети глушатся | `check-permissions` — RPC 200, в `quiz_results` лёг 1 ряд, `tests_completed_count` стал 1, после теста строки убраны |
| Прямой INSERT в `quiz_results` закрыт | политика снята (см. §3) | `check-permissions` — прямой POST 401 |
| Счётчик проверок в скрипте | `scripts/check-permissions.mjs`: было 10, стало 13 (RPC, ряд в `quiz_results`, счётчик профиля) | 13/13 PASS, exit 0 |
| Кэш клиента сброшен под новую версию `quiz.js` | `sw.js`: `CACHE_NAME` `psy-hub-v33` → `psy-hub-v34` | `node --check` на `quiz.js`/`sw.js`; `npm run check:ui` — 12 сценариев, **109/109** |

## 5. Контент, который есть только в БД — архив (решение владельца)

Сверка `.audit/export-all2` (экспорт БД) с `materials/*/content/*.json` (`.audit/compare-materials.mjs`):

| Таблица | В БД | В файлах | Совпало по ключу | Только в БД | Расхождений по полям |
|---|---:|---:|---:|---:|---:|
| `articles` | 196 | 129 | 129 | 67 | 0 |
| `tickets` | 168 | 168 | 168 | 0 | 0 |
| `flashcards` | 774 | 597 | 597 | 177 | 0 |
| `tests` | 432 | 292 | 292 | 140 | 0 |
| `library` | 20 | 0 | 0 | 20 | 0 |

67 статей / 177 карточек / 140 тестов — легаси общей (22/65/30), социальной (15/52/30) и возрастной
(30/60/80) психологии: у этих трёх дисциплин в `materials/` есть только `tickets.json`.

**Решение:** файлы не выгружать, строки считать архивом. Риск принят: если строка пропадёт из БД,
из `materials/` её не восстановить — только из дампа `backups/` (или artifact GitHub, 14 дней).

## 6. Что осталось

1. **Источники статей.** Колонка готова, но `source` пуст у всех 196 статей — в `materials` его
   нет ни у одной дисциплины (кроме `_example`). Это работа редактора контента: добавить `source`
   в JSON и импортировать. Импорт — зеркало: если в файле поля нет, в БД оно станет `null`.
2. **Дубли тестов** (7 вопросов в двух дисциплинах) — контент, не схема.
3. **Прогресс карточек** (`cards.html`) не сохраняется — интерфейс, не бэкенд.
4. Записи `quiz_results` теперь появляются только у тех, у кого есть ключ (вошёл/создал ID).
   Гостю результат по-прежнему не сохраняется — так и задумано.

## 7. Чем это проверялось

```powershell
node scripts/check-permissions.mjs                  # 13/13 PASS, exit 0
node scripts/db-exec.mjs db/<миграция>.sql --dry-run   # HTTP 201
node scripts/check-vendor.mjs                       # sha256 совпадают
node scripts/content-import.mjs materials/general-psych # новых 0, exit 0
node scripts/content-import.mjs --export .audit/export-all2
node .audit/compare-materials.mjs                   # расхождений 0
node scripts/backup-db.mjs                          # 19 таблиц, 8722 строки
npm run check:ui                                    # 109/109
gh run list --workflow=backup.yml --limit 2         # 42892821932 success
```
