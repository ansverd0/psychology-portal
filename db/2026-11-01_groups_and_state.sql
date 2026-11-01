-- Группы студентов и состояние опроса.
-- Коды: 8X1 — психология, 8X2 — психология образования, 8X3 — психология служебной деятельности;
-- средняя цифра — курс. Набор: 2–4 курс ПетрГУ.

begin;

create table if not exists public.study_groups (
  code text primary key check (code ~ '^8[2-4][1-3]$'),
  course smallint not null check (course between 2 and 4),
  program text not null
);

insert into public.study_groups (code, course, program) values
  ('821', 2, 'Психология'),
  ('822', 2, 'Психология образования'),
  ('823', 2, 'Психология служебной деятельности'),
  ('831', 3, 'Психология'),
  ('832', 3, 'Психология образования'),
  ('833', 3, 'Психология служебной деятельности'),
  ('841', 4, 'Психология'),
  ('842', 4, 'Психология образования'),
  ('843', 4, 'Психология служебной деятельности')
on conflict (code) do nothing;

alter table public.study_groups enable row level security;

drop policy if exists "groups read" on public.study_groups;
create policy "groups read" on public.study_groups for select using (true);

grant select on public.study_groups to anon, authenticated;

-- Группа проверяется по справочнику, курс выводится из группы
drop function if exists public.set_group(text, text);

create or replace function public.set_group(
  p_key text,
  p_group text
) returns smallint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course smallint;
begin
  select course into v_course from study_groups where code = p_group;
  if v_course is null then
    raise exception 'unknown group';
  end if;
  update users_profiles set group_code = p_group, course = v_course where user_key = p_key;
  if not found then
    raise exception 'unknown user_key';
  end if;
  return v_course;
end;
$$;

revoke all on function public.set_group(text, text) from public;
grant execute on function public.set_group(text, text) to anon, authenticated;

-- Состояние опроса для страницы: что уже пройдено и какая группа
create or replace function public.survey_state(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
           'group_code', group_code,
           'course', course,
           'sham_done', exists (select 1 from instrument_responses where user_key = p_key and instrument = 'sham'),
           'sspm_done', exists (select 1 from instrument_responses where user_key = p_key and instrument = 'sspm'),
           'survey_done', survey_done,
           'essay_done', essay_done
         )
    into v
    from users_profiles
   where user_key = p_key;

  if v is null then
    raise exception 'unknown user_key';
  end if;
  return v;
end;
$$;

revoke all on function public.survey_state(text) from public;
grant execute on function public.survey_state(text) to anon, authenticated;

commit;
