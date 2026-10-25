-- 2026-10-25: закрытие публичной записи в Supabase.
-- Было: RLS выключен в 13 из 14 таблиц, anon имел SELECT/INSERT/UPDATE/DELETE на всё.
-- Стало: чтение контента — всем, запись — только service_role (обходит RLS).
-- Исключения: создание профиля и вставка ответов исследовательских методик — разрешены anon,
-- но без чтения/изменения/удаления чужих строк.

begin;

-- 0. Старые политики users_profiles
drop policy if exists "Allow public read access" on public.users_profiles;
drop policy if exists "Allow public insert access" on public.users_profiles;
drop policy if exists "Allow public update access" on public.users_profiles;

-- 1. RLS на всех таблицах public
alter table public.articles enable row level security;
alter table public.disciplines enable row level security;
alter table public.flashcards enable row level security;
alter table public.glossary enable row level security;
alter table public.library enable row level security;
alter table public.news enable row level security;
alter table public.tests enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_library enable row level security;
alter table public.version_control enable row level security;
alter table public.initial_anxiety_tests enable row level security;
alter table public.quiz_results enable row level security;
alter table public.session_essays enable row level security;
alter table public.users_profiles enable row level security;

-- 2. Чтение контента разрешено всем
create policy "content read" on public.articles for select to anon, authenticated using (true);
create policy "content read" on public.disciplines for select to anon, authenticated using (true);
create policy "content read" on public.flashcards for select to anon, authenticated using (true);
create policy "content read" on public.glossary for select to anon, authenticated using (true);
create policy "content read" on public.library for select to anon, authenticated using (true);
create policy "content read" on public.news for select to anon, authenticated using (true);
create policy "content read" on public.tests for select to anon, authenticated using (true);
create policy "content read" on public.tickets for select to anon, authenticated using (true);
create policy "content read" on public.ticket_library for select to anon, authenticated using (true);
create policy "content read" on public.version_control for select to anon, authenticated using (true);

-- 3. Профили: вход по ключу и создание нового профиля
create policy "profiles read" on public.users_profiles for select to anon, authenticated using (true);
create policy "profiles insert" on public.users_profiles for insert to anon, authenticated with check (true);

-- 4. Исследовательские данные: только вставка (чтение — service_role / выгрузка исследователем)
create policy "anxiety insert" on public.initial_anxiety_tests for insert to anon, authenticated with check (true);
create policy "quiz insert" on public.quiz_results for insert to anon, authenticated with check (true);
create policy "essay insert" on public.session_essays for insert to anon, authenticated with check (true);

-- 5. Гранты: снимаем всё лишнее и выдаём минимум
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant usage on schema public to anon, authenticated;

grant select on
    public.articles,
    public.disciplines,
    public.flashcards,
    public.glossary,
    public.library,
    public.news,
    public.tests,
    public.tickets,
    public.ticket_library,
    public.version_control
to anon, authenticated;

-- Только ключ и дата создания, без служебных полей
grant select (user_key, created_at) on public.users_profiles to anon, authenticated;
grant insert (user_key) on public.users_profiles to anon, authenticated;

-- Ответы методик: писать можно, читать через API — нельзя
grant insert on
    public.initial_anxiety_tests,
    public.quiz_results,
    public.session_essays
to anon, authenticated;

grant usage, select on all sequences in schema public to anon, authenticated;

-- Новые таблицы в public не должны автоматически получать права anon
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

notify pgrst, 'reload schema';

commit;
