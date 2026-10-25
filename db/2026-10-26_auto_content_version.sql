-- 2026-10-26: автоматическая версия контента.
-- Любое изменение контентной таблицы обновляет public.version_control.version,
-- поэтому клиентам не нужно вручную бампать версию после правок.

begin;

insert into public.version_control (version)
select '1.0.0'
where not exists (select 1 from public.version_control);

create or replace function public.bump_content_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.version_control
       set version = md5(clock_timestamp()::text || random()::text);
    return null;
end;
$$;

drop trigger if exists content_version_articles on public.articles;
create trigger content_version_articles
    after insert or update or delete on public.articles
    for each statement execute function public.bump_content_version();

drop trigger if exists content_version_tickets on public.tickets;
create trigger content_version_tickets
    after insert or update or delete on public.tickets
    for each statement execute function public.bump_content_version();

drop trigger if exists content_version_tests on public.tests;
create trigger content_version_tests
    after insert or update or delete on public.tests
    for each statement execute function public.bump_content_version();

drop trigger if exists content_version_flashcards on public.flashcards;
create trigger content_version_flashcards
    after insert or update or delete on public.flashcards
    for each statement execute function public.bump_content_version();

drop trigger if exists content_version_glossary on public.glossary;
create trigger content_version_glossary
    after insert or update or delete on public.glossary
    for each statement execute function public.bump_content_version();

drop trigger if exists content_version_library on public.library;
create trigger content_version_library
    after insert or update or delete on public.library
    for each statement execute function public.bump_content_version();

drop trigger if exists content_version_news on public.news;
create trigger content_version_news
    after insert or update or delete on public.news
    for each statement execute function public.bump_content_version();

drop trigger if exists content_version_ticket_library on public.ticket_library;
create trigger content_version_ticket_library
    after insert or update or delete on public.ticket_library
    for each statement execute function public.bump_content_version();

drop trigger if exists content_version_disciplines on public.disciplines;
create trigger content_version_disciplines
    after insert or update or delete on public.disciplines
    for each statement execute function public.bump_content_version();

notify pgrst, 'reload schema';

commit;
