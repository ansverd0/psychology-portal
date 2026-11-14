-- Цифровой след, миграция v1: флаг тестовых ключей и идемпотентность событий.
-- Аддитивно: старые клиенты (без event_id) работают как раньше.
-- Перед применением: node scripts/backup-db.mjs
-- Применение: node scripts/db-exec.mjs db/2026-11-15_footprint_v1.sql --dry-run
--             node scripts/db-exec.mjs db/2026-11-15_footprint_v1.sql

begin;

-- 1. Тестовые ключи: их события и ответы не входят в анализ.
--    Список известных ключей помечается один раз; новые — вручную.
alter table public.users_profiles
  add column if not exists is_test boolean not null default false;

create index if not exists users_profiles_is_test_idx
  on public.users_profiles (user_key) where is_test;

update public.users_profiles
   set is_test = true
 where user_key in ('белый-кедр-73', 'тестовый-ключ-11', 'test-key-11')
   and is_test = false;

-- 2. Идемпотентность событий: клиент генерирует event_id на каждое событие.
--    NULL у старых записей: в PostgreSQL NULL-ы в уникальном индексе не конфликтуют,
--    поэтому существующие строки и старые клиенты ничего не ломают.
alter table public.events
  add column if not exists event_id text
  check (event_id is null or event_id ~ '^[a-zA-Z0-9-]{8,64}$');

create unique index if not exists events_user_event_id_uidx
  on public.events (user_key, event_id);

-- 3. Приём событий: дедуп по event_id, возвращается число реально вставленных строк.
create or replace function public.log_events(
  p_key text,
  p_session text,
  p_events jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not exists (select 1 from users_profiles where user_key = p_key) then
    raise exception 'unknown user_key';
  end if;
  if p_session is null or p_session !~ '^[a-zA-Z0-9-]{8,64}$' then
    raise exception 'bad session id';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'events must be an array';
  end if;
  if jsonb_array_length(p_events) > 100 then
    raise exception 'batch too large';
  end if;

  insert into events (user_key, session_id, page, event, ts, dwell_ms, scroll_pct, meta, event_id)
  select p_key,
         p_session,
         left(coalesce(e ->> 'page', 'unknown'), 40),
         left(coalesce(e ->> 'event', 'unknown'), 40),
         least(
           case when (e ->> 'ts') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (e ->> 'ts')::timestamptz end,
           now()
         ),
         case when (e ->> 'dwell_ms') ~ '^[0-9]{1,9}$' then least((e ->> 'dwell_ms')::int, 86400000) end,
         case when (e ->> 'scroll_pct') ~ '^[0-9]{1,3}$' then least((e ->> 'scroll_pct')::int, 100) end,
         case
           when jsonb_typeof(e -> 'meta') = 'object' and pg_column_size(e -> 'meta') <= 2000
             then e -> 'meta'
           else '{}'::jsonb
         end,
         case
           when (e ->> 'event_id') ~ '^[a-zA-Z0-9-]{8,64}$' then e ->> 'event_id'
           else null
         end
  from jsonb_array_elements(p_events) as e
  where (e ->> 'event') ~ '^[a-z_]{3,40}$'
    and (e ->> 'page') ~ '^[a-z0-9_-]{1,40}$'
  on conflict (user_key, event_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.log_events(text, text, jsonb) from public;
grant execute on function public.log_events(text, text, jsonb) to anon, authenticated;

commit;
