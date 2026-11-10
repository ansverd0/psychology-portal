-- N14: у статьи должен быть источник.
-- materials/README.md обещает поле source, content-import.mjs его принимает (строка 250),
-- но в таблице колонки не было — поле молча терялось при импорте.
-- Заполнение: значения из materials/*/content/articles.json (на 10.11.2026 их там нет ни у одной
-- дисциплины, кроме _example, поэтому колонка остаётся NULL до первой правки редактора).
-- Проверка после наката: node scripts/content-import.mjs --export .audit/export-source
--                          → в articles.json появился ключ source.

begin;

alter table public.articles add column if not exists source text;

comment on column public.articles.source is
  'Источник статьи: откуда взят материал (поле source из materials/*/content/articles.json)';

notify pgrst, 'reload schema';

commit;
