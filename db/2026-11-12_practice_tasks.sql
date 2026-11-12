-- 2026-11-12: «Практикум» — задания верхних уровней таксономии Блума.
--
-- Контракт: docs/SPEC-PRACTICE.md §4. Аддитивно: существующие таблицы не меняются,
-- добавляются только public.practice_tasks, public.practice_attempts, две RPC,
-- политика чтения и два триггера.
--
-- Принцип доступа: задания читает любой; попытки пишутся ТОЛЬКО через
-- submit_practice_attempt (SECURITY DEFINER), прямой insert/select закрыт.
--
-- Перед применением: node scripts/backup-db.mjs
-- Применение: node scripts/db-exec.mjs db/2026-11-12_practice_tasks.sql --dry-run
--             node scripts/db-exec.mjs db/2026-11-12_practice_tasks.sql

begin;

-- 1. Валидаторы jsonb. В CHECK нельзя подзапрос, поэтому проверка структуры
--    criteria/options вынесена в immutable-функции.
create or replace function public.practice_options_valid(p jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when p is null or jsonb_typeof(p) <> 'array' then false
    when jsonb_array_length(p) not between 2 and 6 then false
    else not exists (
      select 1
      from jsonb_array_elements(p) as e(v)
      where jsonb_typeof(e.v) <> 'string'
         or char_length(btrim(e.v #>> '{}')) not between 1 and 300
    )
    and (select count(*) from jsonb_array_elements_text(p))
      = (select count(distinct x) from jsonb_array_elements_text(p) as t(x))
  end;
$$;

create or replace function public.practice_criteria_valid(p jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when p is null or jsonb_typeof(p) <> 'array' then false
    when jsonb_array_length(p) not between 3 and 5 then false
    else not exists (
      select 1
      from jsonb_array_elements(p) as e(v)
      where jsonb_typeof(e.v) <> 'string'
         or char_length(btrim(e.v #>> '{}')) not between 10 and 300
    )
  end;
$$;

-- 2. Задания практикума
create table if not exists public.practice_tasks (
  id bigserial primary key,
  discipline_id text not null references public.disciplines (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]{3,64}$'),
  level text not null check (level in ('remember', 'understand', 'apply', 'analyze', 'evaluate', 'create')),
  competence text,
  title text not null check (char_length(btrim(title)) between 5 and 200),
  situation text not null check (char_length(btrim(situation)) between 50 and 5000),
  task text not null check (char_length(btrim(task)) between 20 and 2000),
  kind text not null check (kind in ('choice', 'open')),
  options jsonb,
  correct_index integer,
  criteria jsonb not null check (public.practice_criteria_valid(criteria)),
  model_answer text check (model_answer is null or char_length(model_answer) <= 8000),
  explanation text check (explanation is null or char_length(explanation) <= 2000),
  source text check (source is null or char_length(source) <= 500),
  ai_generated boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint practice_tasks_discipline_slug_key unique (discipline_id, slug),
  constraint practice_tasks_kind_shape check (
    case kind
      when 'choice' then
        case
          when public.practice_options_valid(options) then
            correct_index is not null
            and correct_index between 0 and jsonb_array_length(options) - 1
            and explanation is not null
            and char_length(btrim(explanation)) between 20 and 2000
          else false
        end
      when 'open' then
        options is null
        and correct_index is null
        and model_answer is not null
        and char_length(btrim(model_answer)) between 50 and 8000
      else false
    end
  )
);

-- 3. Попытки: одна строка на попытку, пишется только через RPC
create table if not exists public.practice_attempts (
  id bigserial primary key,
  user_key text not null references public.users_profiles (user_key) on delete cascade,
  task_id bigint not null references public.practice_tasks (id) on delete cascade,
  answer jsonb not null,
  self_score smallint,
  max_score smallint,
  is_correct boolean,
  duration_ms integer,
  created_at timestamptz not null default now(),
  constraint practice_attempts_answer_object check (jsonb_typeof(answer) = 'object'),
  constraint practice_attempts_score_exclusive check (not (is_correct is not null and self_score is not null)),
  constraint practice_attempts_scores_together check ((self_score is null) = (max_score is null)),
  constraint practice_attempts_self_score_range check (
    self_score is null or (self_score >= 0 and max_score is not null and self_score <= max_score)
  ),
  constraint practice_attempts_max_score_range check (max_score is null or max_score between 0 and 20),
  constraint practice_attempts_duration check (duration_ms is null or duration_ms between 5000 and 7200000)
);

create index if not exists practice_attempts_user_created_idx
  on public.practice_attempts (user_key, created_at);
create index if not exists practice_attempts_task_created_idx
  on public.practice_attempts (task_id, created_at);

-- 4. updated_at у задания
create or replace function public.touch_practice_task()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists practice_tasks_touch on public.practice_tasks;
create trigger practice_tasks_touch
  before update on public.practice_tasks
  for each row execute function public.touch_practice_task();

-- 5. Версия контента: правка задания поднимает version_control, как у остальных контентных таблиц
drop trigger if exists content_version_practice on public.practice_tasks;
create trigger content_version_practice
  after insert or update or delete on public.practice_tasks
  for each statement execute function public.bump_content_version();

-- 6. RLS и гранты
alter table public.practice_tasks enable row level security;
alter table public.practice_attempts enable row level security;

drop policy if exists "practice read" on public.practice_tasks;
create policy "practice read" on public.practice_tasks
  for select to anon, authenticated using (true);

-- practice_attempts: политик для anon/authenticated нет намеренно.

revoke all on public.practice_tasks, public.practice_attempts from anon, authenticated;
revoke all on sequence public.practice_tasks_id_seq from anon, authenticated;
revoke all on sequence public.practice_attempts_id_seq from anon, authenticated;

grant select on public.practice_tasks to anon, authenticated;

-- service_role используется импортом и выгрузкой; политики RLS его не ограничивают
grant all on public.practice_tasks, public.practice_attempts to service_role;
grant usage, select on sequence public.practice_tasks_id_seq to service_role;
grant usage, select on sequence public.practice_attempts_id_seq to service_role;

-- 7. RPC: приём попытки. Всё, что считается (is_correct, max_score), считает сервер.
create or replace function public.submit_practice_attempt(
  p_key text,
  p_task_id bigint,
  p_answer jsonb,
  p_self_score integer default null,
  p_duration_ms integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.practice_tasks%rowtype;
  v_choice_text text;
  v_choice integer;
  v_text text;
  v_max integer;
  v_self smallint;
  v_is_correct boolean;
  v_id bigint;
begin
  if p_key is null or not exists (select 1 from users_profiles where user_key = p_key) then
    raise exception 'unknown user_key';
  end if;

  select * into v_task from practice_tasks where id = p_task_id and active;
  if not found then
    raise exception 'unknown task';
  end if;

  if p_answer is null or jsonb_typeof(p_answer) is distinct from 'object' then
    raise exception 'bad answer';
  end if;

  if p_duration_ms is not null and (p_duration_ms < 5000 or p_duration_ms > 7200000) then
    raise exception 'bad duration';
  end if;

  if v_task.kind = 'choice' then
    v_choice_text := p_answer ->> 'choice';
    if v_choice_text is null or v_choice_text !~ '^[0-9]{1,3}$' then
      raise exception 'bad choice';
    end if;
    v_choice := v_choice_text::integer;
    if v_choice >= jsonb_array_length(v_task.options) then
      raise exception 'bad choice';
    end if;
    if p_self_score is not null then
      raise exception 'bad self_score';
    end if;

    v_is_correct := (v_choice = v_task.correct_index);
    v_self := null;
    v_max := null;

    insert into practice_attempts (user_key, task_id, answer, self_score, max_score, is_correct, duration_ms)
    values (p_key, p_task_id, jsonb_build_object('choice', v_choice), null, null, v_is_correct, p_duration_ms)
    returning id into v_id;
  else
    if jsonb_typeof(p_answer -> 'text') is distinct from 'string' then
      raise exception 'bad answer';
    end if;
    v_text := btrim(p_answer ->> 'text');
    if char_length(v_text) < 30 or char_length(v_text) > 8000 then
      raise exception 'bad answer';
    end if;

    v_max := jsonb_array_length(v_task.criteria) * 2;
    if p_self_score is null then
      raise exception 'bad self_score';
    end if;
    if p_self_score < 0 or p_self_score > v_max then
      raise exception 'bad self_score';
    end if;

    v_self := p_self_score::smallint;
    v_is_correct := null;

    insert into practice_attempts (user_key, task_id, answer, self_score, max_score, is_correct, duration_ms)
    values (p_key, p_task_id, jsonb_build_object('text', v_text), v_self, v_max::smallint, null, p_duration_ms)
    returning id into v_id;
  end if;

  return jsonb_build_object(
    'attempt_id', v_id,
    'is_correct', v_is_correct,
    'self_score', v_self,
    'max_score', v_max
  );
end;
$$;

revoke all on function public.submit_practice_attempt(text, bigint, jsonb, integer, integer) from public;
grant execute on function public.submit_practice_attempt(text, bigint, jsonb, integer, integer) to anon, authenticated;

-- 8. RPC: прогресс по задачам для ключа (для страницы и другого устройства)
create or replace function public.practice_progress(p_key text)
returns table (
  task_id bigint,
  attempts integer,
  best_self_score integer,
  max_score integer,
  last_at timestamptz,
  last_is_correct boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null or not exists (select 1 from users_profiles where user_key = p_key) then
    raise exception 'unknown user_key';
  end if;

  return query
  select a.task_id,
         count(*)::integer as attempts,
         max(a.self_score)::integer as best_self_score,
         max(a.max_score)::integer as max_score,
         max(a.created_at) as last_at,
         (array_agg(a.is_correct order by a.created_at desc, a.id desc))[1] as last_is_correct
  from practice_attempts a
  where a.user_key = p_key
  group by a.task_id;
end;
$$;

revoke all on function public.practice_progress(text) from public;
grant execute on function public.practice_progress(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
