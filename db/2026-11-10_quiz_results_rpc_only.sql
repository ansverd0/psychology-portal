-- quiz_results: писать можно только через RPC.
--
-- Что было: политика "quiz insert" разрешала anon INSERT с WITH CHECK (true) — то есть
-- любой мог записать «результат теста» с произвольным user_key, не проходя проверку ключа,
-- и тем самым испортить исследовательские данные (накрутить tests_completed_count).
-- Что есть: public.log_quiz_result(p_key, p_discipline, p_score, p_total) — SECURITY DEFINER,
-- проверяет, что user_key существует, score в [0, total], total в [1, 200], ди-на в формате
-- [a-z0-9-], сам считает percentage и поднимает users_profiles.tests_completed_count.
-- Клиент прямой INSERT в таблицу не делает вовсе (git grep quiz_results js/ → 0).
--
-- Поэтому прямой путь закрываем, RPC continues to work (SECURITY DEFINER обходит RLS).
-- Проверка после наката: node scripts/check-permissions.mjs — «anon пишет результат через RPC»
-- 200, «anon НЕ пишет в quiz_results напрямую» 401.

begin;

drop policy if exists "quiz insert" on public.quiz_results;

notify pgrst, 'reload schema';

commit;
