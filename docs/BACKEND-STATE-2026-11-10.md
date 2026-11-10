# Бэкенд: состояние и решения, 10.11.2026

Документ фиксирует, что сделано в чате «бэкенд» и какие решения принял владелец. Заменяет собой переписку:
если через месяц непонятно, почему `articles.source` так и нет — ответ здесь.

## 1. Бэкапы восстановлены (P0 закрыт)

| Что | Доказательство |
|---|---|
| Причина 9 падений | лог запуска 42801555895, шаг «Dump and encrypt»: `Error: HTTP 401: {"message":"Invalid access token"}` — секрет `SUPABASE_PAT` в GitHub содержал отозванный токен (создан 25.10, с тех пор не менялся) |
| Секреты | `SUPABASE_PAT` и `SUPABASE_PROJECT_REF` обновлены 10.11.2026 19:29 UTC; `BACKUP_PASSPHRASE` не трогали |
| Зелёный запуск | `workflow_dispatch`, run [42885777053](https://github.com/ansverd0/psychology-portal/actions/runs/42885777053) — success |
| Артефакт проверен | `db-backup-42885777053`, 913 292 байта; `gpg --decrypt` с паролем из `backuppassphrase.txt` → exit 0; внутри 19 JSON + `_security_before.json`, 8722 строки |
| Сверка строк | articles 196, tickets 168, flashcards 774, tests 432, glossary 365, library 20, news 10, ticket_library 377, disciplines 30, users_profiles 34, events 6122, instrument_responses 56, instrument_keys 128, study_groups 9, version_control 1; quiz_results / session_essays / initial_anxiety_tests / deadlines — 0 |
| Локальный дамп | `node scripts/backup-db.mjs` → `backups/2026-11-10-19-30_db` (19 таблиц, 8722 строки, совпадает с артефактом строка в строку) |

`events` вырос с 6055 (аудит 10.11) до 6122 — это нормальный прирост, а не расхождение.

Ловушка в `backup.yml` («нет секретов → warning + `exit 0`») убрана: теперь `exit 1`. Монитор
`monitor.yml` раз в 30 минут проверяет, что последний успешный `backup.yml` не старше 26 часов.

## 2. Ротация PAT отложена (решение владельца)

10.11.2026 в переписке засветился PAT, который сейчас работает. Владелец решил **не перевыпускать его
сразу**. Что это значит практически:

- токен действует и лежит в `.env` и в GitHub Secrets (в Secrets он был записан этим чатом, чтобы поднять бэкап);
- пока токен не отозван, любой, у кого он есть, может через Management API читать и менять базу в обход RLS;
- когда решите ротировать: Supabase → Account → Access Tokens → Revoke старый → создать новый → `git`-секрет и `.env` обновить, проверить `node scripts/backup-db.mjs`. Порядок — `docs/RUNBOOK.md` §4.

## 3. Схема БД: решено ничего не менять (10.11.2026)

Проверено фактически, менять пока не будем:

| Вопрос | Факт | Решение |
|---|---|---|
| N14 `articles.source` | в схеме `articles` колонок 5: `id, discipline_id, title, content, ai_generated`; `content-import.mjs:250` принимает `source` из JSON, `validateArticle` (`:92-102`) его не возвращает, `DB_FIELDS.articles` (`:282`) не пишет — поле теряется молча | отложено |
| Мёртвые строки `disciplines` | 30 строк, из них 14 пустых; `general-exam`, `social-exam`, `developmental-exam` — 0 строк во всех контентных таблицах и 0 ссылок в `deadlines` (в `study_groups` колонки `discipline_id` нет вовсе) | отложено, удалять безопасно, когда решите |
| Индексы под дисциплину | новые не нужны: у каждой контентной таблицы уже есть уникальный индекс с `discipline_id` первым столбцом — `articles(discipline_id,title)`, `tickets(discipline_id,number)`, `flashcards(discipline_id,term)`, `tests(discipline_id,question)`, `ticket_library(ticket_id,book_id)` | закрыто без изменений |
| `quiz_results` | RPC **уже есть**: `log_quiz_result(p_key, p_discipline, p_score, p_total)` — `SECURITY DEFINER`, проверяет ключ, диапазоны счёта, пишет `percentage` и поднимает `users_profiles.tests_completed_count`. Клиент его не вызывает (`git grep quiz_results js/` → 0). Политика `quiz insert` разрешает `anon` прямой INSERT с `with check (true)` — минуя проверку ключа | отложено; RPC создавать не надо, надо звать его из клиента. Прямой INSERT — дыра для накрутки research-данных, закрывать только вместе с фронтендом |
| `--export` игнорирует дисциплину | `exportContent` (`scripts/content-import.mjs:369-391`) выгружает таблицы целиком | отложено (обходной путь — фильтровать JSON после экспорта) |

## 4. Контент, который есть только в БД — архивирован (решение владельца)

Сверка `.audit/export-all` (экспорт БД) с `materials/*/content/*.json` (скрипт `.audit/compare-materials.mjs`):

| Таблица | В БД | В файлах | Совпало по ключу | Только в БД | Расхождений по полям |
|---|---:|---:|---:|---:|---:|
| `articles` | 196 | 129 | 129 | 67 | 0 |
| `tickets` | 168 | 168 | 168 | 0 | 0 |
| `flashcards` | 774 | 597 | 597 | 177 | 0 |
| `tests` | 432 | 292 | 292 | 140 | 0 |
| `library` | 20 | 0 | 0 | 20 | 0 |

67 статей / 177 карточек / 140 тестов — легаси общей (22/65/30), социальной (15/52/30) и возрастной (30/60/80)
психологии: у этих трёх дисциплин в `materials/` есть только `tickets.json`.

**Решение:** файлы не выгружать, строки считать архивом. Риск принят: если строка пропадёт из БД, из
`materials/` её не восстановить — только из дампа `backups/` (или artifact GitHub, 14 дней).
Расхождений по полям у совпавших 1186 строк нет ни одного, то есть источник и база не разъехались.

## 5. Что осталось сделать по бэкенду

1. Ротация PAT (п. 2) — когда решите.
2. Миграции из п. 3 — когда решите; для N14 порядок такой: бэкап (есть) → `db/2026-11-10_articles_source.sql`
   → `DB_FIELDS.articles` + `validateArticle` → заполнить из `materials` → обратный `--export` для проверки.
3. `--export` с фильтром по дисциплине — правка одного скрипта, никого не блокирует.
4. `quiz_results`: подключить `log_quiz_result` в `js/quiz.js` (фронтенд) и закрыть прямой INSERT.
