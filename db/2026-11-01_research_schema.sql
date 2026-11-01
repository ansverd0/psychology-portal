-- Исследовательская схема ВКР: опросники, журнал поведения, дедлайны.
-- Аддитивно: существующие таблицы и запросы сайта не меняются.
-- Перед применением: node scripts/backup-db.mjs
-- Применение: node scripts/db-exec.mjs db/2026-11-01_research_schema.sql --dry-run
--             node scripts/db-exec.mjs db/2026-11-01_research_schema.sql

begin;

-- 1. Профиль: курс (для привязки дедлайнов) и флаги прохождения
alter table public.users_profiles
  add column if not exists course smallint check (course between 1 and 6),
  add column if not exists survey_done boolean not null default false,
  add column if not exists essay_done boolean not null default false,
  add column if not exists tests_completed_count integer not null default 0;

-- 2. Справочник ключей методик: какие пункты в какую шкалу и с каким знаком
create table if not exists public.instrument_keys (
  instrument text not null check (instrument in ('sham', 'sspm')),
  scale text not null,
  item_no smallint not null check (item_no between 1 and 46),
  sign smallint not null check (sign in (1, -1)),
  primary key (instrument, item_no, scale)
);

-- 3. Ответы: одна запись на методику на ключ
create table if not exists public.instrument_responses (
  id bigserial primary key,
  user_key text not null references public.users_profiles (user_key) on delete cascade,
  instrument text not null check (instrument in ('sham', 'sspm')),
  answers jsonb not null,
  scales jsonb not null,
  duration_ms integer check (duration_ms is null or duration_ms between 30000 and 7200000),
  finished_at timestamptz not null default now(),
  unique (user_key, instrument)
);

-- 4. Журнал поведения (цифровой след)
create table if not exists public.events (
  id bigserial primary key,
  user_key text not null references public.users_profiles (user_key) on delete cascade,
  session_id text not null,
  page text not null,
  event text not null,
  ts timestamptz not null,
  dwell_ms integer check (dwell_ms is null or dwell_ms between 0 and 86400000),
  scroll_pct smallint check (scroll_pct is null or scroll_pct between 0 and 100),
  meta jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create index if not exists events_user_ts_idx on public.events (user_key, ts);
create index if not exists events_session_idx on public.events (session_id);
create index if not exists events_event_ts_idx on public.events (event, ts);

-- 5. Дедлайны сессии по курсам (заполняются, когда появится расписание)
create table if not exists public.deadlines (
  id serial primary key,
  course smallint not null check (course between 1 and 6),
  discipline_id text not null,
  kind text not null check (kind in ('exam', 'credit', 'test')),
  due_at timestamptz not null
);

create index if not exists deadlines_course_idx on public.deadlines (course, due_at);

-- 6. Эссе: коды контент-анализа и объём; одно эссе на ключ
alter table public.session_essays
  add column if not exists codes jsonb,
  add column if not exists word_count integer;

create unique index if not exists session_essays_user_key_uidx on public.session_essays (user_key);

-- 7. RLS: клиент не читает исследования напрямую. Доступ — только через RPC ниже
alter table public.instrument_keys enable row level security;
alter table public.instrument_responses enable row level security;
alter table public.events enable row level security;
alter table public.deadlines enable row level security;

revoke all on public.instrument_keys, public.instrument_responses, public.events, public.deadlines
  from anon, authenticated;

-- 8. Ключи методик
-- ШАМ: 28 утверждений, 7 шкал по 4, ответ 1–5, сумма 4–20
insert into public.instrument_keys (instrument, scale, item_no, sign)
select 'sham', s.scale, i, 1
from (values
  ('cognitive',    array[1, 8, 15, 22]),
  ('achievement',  array[2, 9, 16, 23]),
  ('selfdev',      array[3, 10, 17, 24]),
  ('selfrespect',  array[4, 11, 18, 25]),
  ('introjected',  array[5, 12, 19, 26]),
  ('external',     array[6, 13, 20, 27]),
  ('amotivation',  array[7, 14, 21, 28])
) as s(scale, items)
cross join lateral unnest(s.items) as i
on conflict do nothing;

-- ССПМ: 46 утверждений, 6 шкал по 9 + общий уровень, ответ 1–4
-- (1 «верно», 2 «пожалуй верно» → да; 3 «пожалуй неверно», 4 «неверно» → нет)
insert into public.instrument_keys (instrument, scale, item_no, sign)
select 'sspm', s.scale, i, 1
from (values
  ('planning',    array[1, 8, 17, 22, 28, 31, 36]),
  ('modeling',    array[11, 37]),
  ('programming', array[12, 20, 25, 29, 38, 43]),
  ('results',     array[30, 44]),
  ('flexibility', array[2, 11, 25, 35, 36, 45]),
  ('autonomy',    array[4, 12, 14, 21, 27, 31, 40, 46]),
  ('overall',     array[1, 2, 4, 8, 11, 12, 14, 17, 20, 21, 22, 25, 27, 28, 29, 30, 31, 35, 36, 37, 38, 40, 43, 44, 45, 46])
) as s(scale, items)
cross join lateral unnest(s.items) as i
on conflict do nothing;

insert into public.instrument_keys (instrument, scale, item_no, sign)
select 'sspm', s.scale, i, -1
from (values
  ('planning',    array[15, 42]),
  ('modeling',    array[3, 7, 19, 23, 26, 33, 41]),
  ('programming', array[5, 9, 32]),
  ('results',     array[6, 10, 13, 16, 24, 34, 39]),
  ('flexibility', array[16, 18, 23]),
  ('autonomy',    array[34]),
  ('overall',     array[3, 5, 6, 7, 9, 10, 13, 15, 16, 18, 19, 23, 24, 26, 32, 33, 34, 39, 41, 42])
) as s(scale, items)
cross join lateral unnest(s.items) as i
on conflict do nothing;

-- 9. RPC: приём ответов методики с подсчётом шкал на сервере
create or replace function public.submit_instrument(
  p_key text,
  p_instrument text,
  p_answers jsonb,
  p_duration_ms integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected integer;
  v_max integer;
  v_scales jsonb;
  v_done boolean;
begin
  if not exists (select 1 from users_profiles where user_key = p_key) then
    raise exception 'unknown user_key';
  end if;

  v_expected := case p_instrument when 'sham' then 28 when 'sspm' then 46 end;
  if v_expected is null then
    raise exception 'unknown instrument';
  end if;
  v_max := case p_instrument when 'sham' then 5 else 4 end;

  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'answers must be an object';
  end if;
  if (select count(*) from jsonb_object_keys(p_answers)) <> v_expected then
    raise exception 'answers must contain exactly % items', v_expected;
  end if;
  if exists (
    select 1 from jsonb_each_text(p_answers) as a(k, v)
    where k !~ '^[0-9]{1,2}$'
       or k::int < 1
       or k::int > v_expected
       or v !~ ('^[1-' || v_max || ']$')
  ) then
    raise exception 'answer keys or values out of range';
  end if;

  select jsonb_object_agg(s.scale, s.total) into v_scales
  from (
    select k.scale,
           sum(
             case
               when p_instrument = 'sspm' then
                 case
                   when k.sign = 1 and (p_answers ->> k.item_no::text)::int <= 2 then 1
                   when k.sign = -1 and (p_answers ->> k.item_no::text)::int > 2 then 1
                   else 0
                 end
               else (p_answers ->> k.item_no::text)::int
             end
           ) as total
    from instrument_keys k
    where k.instrument = p_instrument
    group by k.scale
  ) s;

  insert into instrument_responses (user_key, instrument, answers, scales, duration_ms)
  values (p_key, p_instrument, p_answers, v_scales, p_duration_ms)
  on conflict (user_key, instrument) do nothing;

  select count(*) = 2 into v_done from instrument_responses where user_key = p_key;
  update users_profiles set survey_done = v_done where user_key = p_key;

  return v_scales;
end;
$$;

revoke all on function public.submit_instrument(text, text, jsonb, integer) from public;
grant execute on function public.submit_instrument(text, text, jsonb, integer) to anon, authenticated;

-- 10. RPC: приём пакета событий
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

  insert into events (user_key, session_id, page, event, ts, dwell_ms, scroll_pct, meta)
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
         end
  from jsonb_array_elements(p_events) as e
  where (e ->> 'event') ~ '^[a-z_]{3,40}$'
    and (e ->> 'page') ~ '^[a-z0-9_-]{1,40}$';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.log_events(text, text, jsonb) from public;
grant execute on function public.log_events(text, text, jsonb) to anon, authenticated;

-- 11. RPC: эссе, одно на ключ
create or replace function public.submit_essay(
  p_key text,
  p_motive text,
  p_emotion text,
  p_evaluation text,
  p_regulation text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_words integer;
begin
  if not exists (select 1 from users_profiles where user_key = p_key) then
    raise exception 'unknown user_key';
  end if;
  if coalesce(length(btrim(p_motive)), 0) < 30
     or coalesce(length(btrim(p_emotion)), 0) < 30
     or coalesce(length(btrim(p_evaluation)), 0) < 30
     or coalesce(length(btrim(p_regulation)), 0) < 30 then
    raise exception 'essay answers are too short';
  end if;
  if greatest(length(p_motive), length(p_emotion), length(p_evaluation), length(p_regulation)) > 4000 then
    raise exception 'essay answer is too long';
  end if;

  v_words := array_length(regexp_split_to_array(btrim(p_motive || ' ' || p_emotion || ' ' || p_evaluation || ' ' || p_regulation), '\s+'), 1);

  insert into session_essays (user_key, motive_text, emotion_text, evaluation_text, regulation_text, word_count)
  values (p_key, btrim(p_motive), btrim(p_emotion), btrim(p_evaluation), btrim(p_regulation), v_words)
  on conflict (user_key) do nothing;

  update users_profiles set essay_done = true where user_key = p_key;
  return v_words;
end;
$$;

revoke all on function public.submit_essay(text, text, text, text, text) from public;
grant execute on function public.submit_essay(text, text, text, text, text) to anon, authenticated;

-- 12. RPC: результат теста (знания, не методика) + счётчик
create or replace function public.log_quiz_result(
  p_key text,
  p_discipline text,
  p_score integer,
  p_total integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pct integer;
begin
  if not exists (select 1 from users_profiles where user_key = p_key) then
    raise exception 'unknown user_key';
  end if;
  if p_total is null or p_total < 1 or p_total > 200 then
    raise exception 'bad total';
  end if;
  if p_score is null or p_score < 0 or p_score > p_total then
    raise exception 'bad score';
  end if;
  if p_discipline is null or p_discipline !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'bad discipline';
  end if;

  v_pct := round(p_score::numeric * 100 / p_total)::int;

  insert into quiz_results (user_key, discipline_id, score_obtained, total_questions, percentage)
  values (p_key, p_discipline, p_score, p_total, v_pct);

  update users_profiles
     set tests_completed_count = tests_completed_count + 1
   where user_key = p_key;

  return v_pct;
end;
$$;

revoke all on function public.log_quiz_result(text, text, integer, integer) from public;
grant execute on function public.log_quiz_result(text, text, integer, integer) to anon, authenticated;

-- 13. RPC: курс (для привязки дедлайнов)
create or replace function public.set_course(
  p_key text,
  p_course smallint
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_course is null or p_course < 1 or p_course > 6 then
    raise exception 'bad course';
  end if;
  update users_profiles set course = p_course where user_key = p_key;
  if not found then
    raise exception 'unknown user_key';
  end if;
end;
$$;

revoke all on function public.set_course(text, smallint) from public;
grant execute on function public.set_course(text, smallint) to anon, authenticated;

commit;
