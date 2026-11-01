-- Приводим discipline_id билетов к каноническим id: general-exam → general-psych, social-exam → social-psych.
-- UI уже склеивает их в одну группу, внешне ничего не меняется; импорт получает единый ключ.

begin;

update public.tickets set discipline_id = 'general-psych' where discipline_id = 'general-exam';
update public.tickets set discipline_id = 'social-psych' where discipline_id = 'social-exam';
update public.tickets set discipline_id = 'developmental-psych' where discipline_id = 'developmental-exam';

commit;
