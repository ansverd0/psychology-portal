-- Триггер версии контента падал при записи через PostgREST:
-- роль authenticator грузит safeupdate и запрещает UPDATE без WHERE.
-- Добавляем WHERE true — поведение то же (строка в таблице одна), но запись проходит.

begin;

create or replace function public.bump_content_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.version_control
       set version = md5(clock_timestamp()::text || random()::text)
     where true;
    return null;
end;
$$;

commit;
