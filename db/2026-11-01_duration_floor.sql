-- Минимальная длительность прохождения: 5 с вместо 30 с.
-- 30 с отсекало бы быстрых студентов; от пустых отправок достаточно 5 с.

begin;

alter table public.instrument_responses
  drop constraint if exists instrument_responses_duration_ms_check;

alter table public.instrument_responses
  add constraint instrument_responses_duration_ms_check
  check (duration_ms is null or duration_ms between 5000 and 7200000);

commit;
