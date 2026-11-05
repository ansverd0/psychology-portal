-- Нижняя граница duration_ms: санитарный порог, а не отбраковочный.
--
-- В db/2026-11-01_research_schema.sql стояло «не меньше 30 секунд». Живая схема
-- оказалась с порогом 5 секунд, и это правильно: отказ сервера на последнем экране
-- оставляет человека без возможности закончить опрос, а проверить время чтения
-- по клиенту всё равно нельзя (duration_ms приходит с клиента).
--
-- Поэтому в БД остаётся санитарный порог 5 с (отсечь нули и мусор), а протоколы
-- быстрее 2 секунд на пункт помечаются и исключаются уже в анализе — правило
-- зафиксировано в docs/METHOD-FREEZE.md и реализовано в scripts/survey-report.mjs.

begin;

alter table public.instrument_responses
  drop constraint if exists instrument_responses_duration_ms_check;

alter table public.instrument_responses
  add constraint instrument_responses_duration_ms_check
  check (duration_ms is null or duration_ms between 5000 and 7200000);

commit;
