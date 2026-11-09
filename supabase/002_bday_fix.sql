-- 002: задача «День рождения» стояла на дату рождения (2022) → была просрочена на ~1600 дней.
-- Запустить один раз в Supabase → SQL Editor. Можно запускать повторно.
-- день рождения → ежегодное событие; срок — ближайший день рождения (сегодня или позже), а не день рождения
create or replace function p_next_bday(b date) returns date language sql stable as $$
  select case when d >= current_date then d else (d + interval '1 year')::date end
  from (select (b + make_interval(years => extract(year from age(current_date, b))::int))::date as d) x
$$;
create or replace function p_pet_bday() returns trigger language plpgsql as $$
begin
  if new.birthday is null then
    new.bday_task := null;   -- саму задачу уберёт p_pet_unlinked
    return new;
  end if;
  if new.bday_task is not null and exists (select 1 from tasks where id = new.bday_task) then
    update tasks set title = '🎂 День рождения: ' || new.name, pet = new.kind,
      due_date = case when tg_op = 'INSERT' or new.birthday is distinct from old.birthday
                      then p_next_bday(new.birthday) else due_date end
    where id = new.bday_task;
  else
    insert into tasks (user_id, title, kind, due_date, repeat_every, repeat_unit, repeat_from, pet, section_id)
    values (new.user_id, '🎂 День рождения: ' || new.name, 'event', p_next_bday(new.birthday), 1, 'year', 'due', new.kind, p_section(new.user_id))
    returning id into new.bday_task;
  end if;
  return new;
end $$;

-- поправить уже созданные задачи: срок → ближайший день рождения, отметку «сделано» снять
update tasks t set due_date = p_next_bday(p.birthday), done_on = null
from p_pets p
where p.bday_task = t.id and p.birthday is not null;

select p.name, t.title, t.due_date from p_pets p join tasks t on t.id = p.bday_task;
