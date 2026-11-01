-- Уникальные ключи контента: импорт должен обновлять запись, а не плодить дубли.
-- Дублей в базе нет (проверено 01.11.2026), индексы создаются безопасно.

begin;

create unique index if not exists articles_discipline_title_key
  on public.articles (discipline_id, title);

create unique index if not exists flashcards_discipline_term_key
  on public.flashcards (discipline_id, term);

create unique index if not exists tests_discipline_question_key
  on public.tests (discipline_id, question);

create unique index if not exists tickets_discipline_number_key
  on public.tickets (discipline_id, number);

create unique index if not exists library_title_author_key
  on public.library (title, author);

create unique index if not exists ticket_library_pair_key
  on public.ticket_library (ticket_id, book_id);

commit;
