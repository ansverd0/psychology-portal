-- Группа студента и групповые дедлайны: сессия у групп заканчивается в разные даты.
-- Аддитивно. Перед применением: node scripts/backup-db.mjs

begin;

alter table public.users_profiles
  add column if not exists group_code text
  check (group_code is null or char_length(group_code) between 2 and 20);

alter table public.deadlines
  add column if not exists group_code text
  check (group_code is null or char_length(group_code) between 2 and 20);

create index if not exists deadlines_group_idx on public.deadlines (group_code, due_at);

-- Группа задаётся один раз вместе с курсом
create or replace function public.set_group(
  p_key text,
  p_group text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_group is null or p_group !~ '^[A-Za-zА-Яа-я0-9-]{2,20}$' then
    raise exception 'bad group code';
  end if;
  update users_profiles set group_code = p_group where user_key = p_key;
  if not found then
    raise exception 'unknown user_key';
  end if;
end;
$$;

revoke all on function public.set_group(text, text) from public;
grant execute on function public.set_group(text, text) to anon, authenticated;

commit;
