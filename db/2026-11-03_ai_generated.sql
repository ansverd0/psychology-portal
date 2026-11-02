-- Отметка «сгенерировано ИИ» для статей и билетов.
-- Плашка на странице показывается, когда материал более чем наполовину создан моделью.

begin;

alter table public.articles
  add column if not exists ai_generated boolean not null default false;

alter table public.tickets
  add column if not exists ai_generated boolean not null default false;

commit;
