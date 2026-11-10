-- Полировка реестра и индексов. Ничего не удаляется из контента.
--
-- 1. Мёртвые строки disciplines: general-exam, social-exam, developmental-exam —
--    это псевдонимы из materials/disciplines.json (aliases), заведённые как отдельные
--    дисциплины. Проверено 10.11.2026: 0 строк в articles/tickets/flashcards/tests/glossary,
--    0 строк в deadlines; фронтенд сводит их к каноническим id
--    (js/supabase-config.js:383-385, 412-414), поэтому пользователь их не видел.
--    Удаление безопасно: внешние ключи у контентных таблиц ON DELETE CASCADE,
--    но каскадировать нечего — строк нет.
--
-- 2. Дубль уникального индекса: ticket_library_pair_key и первичный ключ
--    ticket_library_pkey покрывают одни и те же (ticket_id, book_id).
--    Оставляем pkey (его использует ON CONFLICT из content-import.mjs).

begin;

delete from public.disciplines
 where id in ('general-exam', 'social-exam', 'developmental-exam');

drop index if exists public.ticket_library_pair_key;

notify pgrst, 'reload schema';

commit;
