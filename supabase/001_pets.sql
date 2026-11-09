-- «Питомцы»: профили, вес, корм/наполнитель, лекарства, схемы процедур, ветклиника, заметки.
-- Сначала должен быть запущен «Задачи» → supabase/016_early.sql (напоминание заранее, конец повтора).
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.
-- Напоминания — задачи в «Задачах» (tasks, pet = вид питомца). Их создают триггеры ниже, само приложение их не создаёт,
-- кроме ежедневного ухода (обычные задачи с пометкой питомца).

-- ---------- таблицы ----------
create table if not exists p_pets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('cat', 'bird')),   -- = tasks.pet
  name text not null,
  birthday date,
  sex text, breed text, color text, chip text,
  notes text,
  w_min numeric(6, 3), w_norm numeric(6, 3), w_max numeric(6, 3),   -- кг
  w_jump int,                                                       -- г: предупредить, если изменился больше
  bday_task uuid references tasks on delete set null,
  ord int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, kind)
);

create table if not exists p_weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  pet_id uuid not null references p_pets on delete cascade,
  day date not null,
  kg numeric(6, 3) not null check (kg > 0),
  note text,
  created_at timestamptz not null default now()
);

-- корм, наполнитель, другое — периодами
create table if not exists p_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  pet_id uuid not null references p_pets on delete cascade,
  type text not null default 'food' check (type in ('food', 'litter', 'other')),
  name text not null,
  reason text,          -- почему / кто назначил
  start_on date,
  end_on date,          -- пусто = сейчас
  check_on date,        -- «проверить до» → задача
  note text,
  task_id uuid references tasks on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists p_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  pet_id uuid not null references p_pets on delete cascade,
  day date not null,
  clinic text,
  reason text,          -- зачем пришли
  done text,            -- что сделали по факту
  prescribed text,      -- что назначили
  next_on date,         -- следующий приём → задача
  next_why text,
  note text,
  task_id uuid references tasks on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists p_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  pet_id uuid not null references p_pets on delete cascade,
  title text not null,
  body text,
  pinned boolean not null default false,
  updated_at timestamptz not null default now()
);

-- курс лекарства: каждое время приёма — своя задача-привычка с повтором раз в every_days дней по end_on
create table if not exists p_meds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  pet_id uuid not null references p_pets on delete cascade,
  name text not null,                   -- название и дозировка одним полем
  unit text not null default 'табл.',
  amount numeric(8, 3) not null default 1 check (amount > 0),   -- сколько за раз
  times text[] not null default '{09:00}',                      -- во сколько (их число = раз в день)
  every_days int not null default 1 check (every_days between 1 and 60),
  start_on date not null,
  end_on date not null,
  stopped_on date,                      -- закончили раньше
  reason text,
  note text,
  task_ids uuid[],
  created_at timestamptz not null default now(),
  check (end_on >= start_on)
);

-- схемы процедур: steps = [{"t": "От блох", "gap": 0}, {"t": "От глистов", "gap": 7}, ...]
-- gap — через сколько дней после того, как сделан предыдущий шаг
create table if not exists p_schemes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  pet_id uuid not null references p_pets on delete cascade,
  name text not null,
  steps jsonb not null default '[]',
  repeat_months int check (repeat_months is null or repeat_months between 1 and 60),
  remind_days int not null default 7 check (remind_days between 0 and 60),
  ord int not null default 0,
  created_at timestamptz not null default now()
);

-- один «круг» схемы и его шаги
create table if not exists p_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  pet_id uuid not null references p_pets on delete cascade,
  scheme_id uuid references p_schemes on delete set null,
  name text not null,
  start_on date not null,
  prev_run uuid references p_runs on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists p_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  run_id uuid not null references p_runs on delete cascade,
  idx int not null,
  title text not null,
  gap int not null default 0,
  due_on date,          -- считается в p_run_recalc
  done_on date,
  task_id uuid references tasks on delete set null
);

create index if not exists p_weights_pet on p_weights (pet_id, day);
create index if not exists p_steps_task on p_steps (task_id);
create index if not exists p_steps_run on p_steps (run_id, idx);

-- ---------- доступ: каждый видит только своё ----------
do $$
declare t text;
begin
  foreach t in array array['p_pets', 'p_weights', 'p_periods', 'p_visits', 'p_notes', 'p_meds', 'p_schemes', 'p_runs', 'p_steps'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists own on %I', t);
    execute format('create policy own on %I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- realtime (если таблица уже добавлена — пропускаем)
do $$
declare t text;
begin
  foreach t in array array['p_pets', 'p_weights', 'p_periods', 'p_visits', 'p_notes', 'p_meds', 'p_schemes', 'p_runs', 'p_steps'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

-- ---------- задачи ----------
-- раздел «Питомцы» в личном режиме, если есть
create or replace function p_section(p_user uuid) returns uuid language sql stable as $$
  select id from sections where user_id = p_user and lower(name) like 'питомц%'
    and coalesce(space, 'personal') = 'personal' order by position limit 1
$$;

-- создать или обновить разовую задачу. Срок сменился — задача снова не выполнена.
create or replace function p_put_task(p_id uuid, p_user uuid, p_pet text, p_title text, p_notes text, p_due date, p_remind int)
returns uuid language plpgsql as $$
declare tid uuid := p_id;
begin
  if tid is not null and exists (select 1 from tasks where id = tid) then
    update tasks set title = p_title, notes = p_notes, pet = p_pet,
      remind_days = nullif(p_remind, 0),
      done_on = case when due_date is distinct from p_due then null else done_on end,
      due_date = p_due
    where id = tid;
  else
    insert into tasks (user_id, title, notes, due_date, pet, section_id, remind_days)
    values (p_user, p_title, p_notes, p_due, p_pet, p_section(p_user), nullif(p_remind, 0))
    returning id into tid;
  end if;
  return tid;
end $$;

create or replace function p_drop_task(p_id uuid) returns void language sql as $$
  delete from tasks where id = p_id and done_on is null
$$;

create or replace function p_kind(p_pet uuid) returns text language sql stable as $$
  select kind from p_pets where id = p_pet
$$;

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
drop trigger if exists p_pet_bday on p_pets;
create trigger p_pet_bday before insert or update of name, birthday, kind on p_pets
  for each row execute function p_pet_bday();
create or replace function p_pet_unlinked() returns trigger language plpgsql as $$
begin
  if old.bday_task is not null and new.bday_task is distinct from old.bday_task then delete from tasks where id = old.bday_task; end if;
  return null;
end $$;
drop trigger if exists p_pet_unlinked on p_pets;
create trigger p_pet_unlinked after update on p_pets for each row execute function p_pet_unlinked();

-- корм/наполнитель: «проверить до» → задача за неделю
create or replace function p_period_task() returns trigger language plpgsql as $$
declare what text;
begin
  if new.check_on is null or new.end_on is not null then
    new.task_id := null;   -- саму задачу уберёт p_unlinked (after), иначе ссылка мешает
    return new;
  end if;
  what := case new.type when 'food' then 'Корм' when 'litter' then 'Наполнитель' else '' end;
  new.task_id := p_put_task(new.task_id, new.user_id, p_kind(new.pet_id),
    trim(what || ' «' || new.name || '»: ' || case when new.type = 'food' then 'спросить врача, продолжать ли' else 'проверить' end),
    nullif(concat_ws(E'\n', new.reason, new.note), ''), new.check_on, 7);
  return new;
end $$;
drop trigger if exists p_period_task on p_periods;
create trigger p_period_task before insert or update on p_periods
  for each row execute function p_period_task();
-- удалили запись — её несделанная задача тоже уходит (after: иначе ссылка task_id мешает удалению)
create or replace function p_drop_old() returns trigger language plpgsql as $$
begin
  perform p_drop_task(old.task_id);
  return null;
end $$;
-- задачу отвязали (дату убрали, период закрыли) — несделанная задача уходит
create or replace function p_unlinked() returns trigger language plpgsql as $$
begin
  if old.task_id is not null and new.task_id is distinct from old.task_id then perform p_drop_task(old.task_id); end if;
  return null;
end $$;
drop trigger if exists p_period_unlinked on p_periods;
create trigger p_period_unlinked after update on p_periods for each row execute function p_unlinked();
drop trigger if exists p_period_drop on p_periods;
create trigger p_period_drop after delete on p_periods for each row execute function p_drop_old();

-- ветклиника: следующий приём → задача за неделю
create or replace function p_visit_task() returns trigger language plpgsql as $$
begin
  if new.next_on is null then
    new.task_id := null;   -- саму задачу уберёт p_unlinked (after), иначе ссылка мешает
    return new;
  end if;
  new.task_id := p_put_task(new.task_id, new.user_id, p_kind(new.pet_id),
    'Ветклиника: ' || coalesce(nullif(new.next_why, ''), nullif(new.reason, ''), 'приём'),
    nullif(new.clinic, ''), new.next_on, 7);
  return new;
end $$;
drop trigger if exists p_visit_task on p_visits;
create trigger p_visit_task before insert or update on p_visits
  for each row execute function p_visit_task();
drop trigger if exists p_visit_unlinked on p_visits;
create trigger p_visit_unlinked after update on p_visits for each row execute function p_unlinked();
drop trigger if exists p_visit_drop on p_visits;
create trigger p_visit_drop after delete on p_visits for each row execute function p_drop_old();

-- лекарство: по задаче-привычке на каждое время приёма
create or replace function p_med_tasks() returns trigger language plpgsql as $$
declare
  n int; i int; tid uuid; ids uuid[] := '{}'; v_title text; v_first date; v_until date; v_amt text;
  t tasks;
begin
  if tg_op = 'DELETE' then
    delete from tasks where id = any(coalesce(old.task_ids, '{}'));
    return old;
  end if;
  n := coalesce(array_length(new.times, 1), 0);
  v_until := least(new.end_on, coalesce(new.stopped_on, new.end_on));
  -- первый срок: ближайший день приёма, не раньше сегодня (прошлые дни в утреннюю проверку не попадают)
  v_first := new.start_on;
  if v_first < current_date then
    v_first := new.start_on + ((current_date - new.start_on + new.every_days - 1) / new.every_days) * new.every_days;
  end if;
  v_amt := replace(rtrim(rtrim(new.amount::text, '0'), '.'), '.', ',');
  for i in 1..n loop
    v_title := '💊 ' || new.name || ' — ' || v_amt || ' ' || new.unit
      || case when n > 1 then ' (' || new.times[i] || ')' else '' end;
    tid := case when tg_op = 'UPDATE' then old.task_ids[i] end;
    select * into t from tasks where id = tid;
    if found then
      update tasks set title = v_title, pet = p_kind(new.pet_id), remind_at = new.times[i]::time,
        repeat_every = new.every_days, repeat_until = v_until,
        due_date = case when t.done_on is null and (old.start_on <> new.start_on or old.every_days <> new.every_days)
                        then v_first else t.due_date end,
        reminded_on = case when t.remind_at is distinct from new.times[i]::time then null else t.reminded_on end
      where id = tid;
      -- курс продлили — закрытая задача снова идёт
      if t.done_on is not null and v_until > t.done_on then
        update tasks set done_on = null,
          due_date = t.done_on + new.every_days
        where id = tid;
      end if;
    elsif v_first <= v_until then
      insert into tasks (user_id, title, kind, due_date, repeat_every, repeat_unit, repeat_from, repeat_until,
                         remind_at, pet, section_id)
      values (new.user_id, v_title, 'habit', v_first, new.every_days, 'day', 'due', v_until,
              new.times[i]::time, p_kind(new.pet_id), p_section(new.user_id))
      returning id into tid;
    else
      tid := null;
    end if;
    if tid is not null then ids := ids || tid; end if;
  end loop;
  -- времён стало меньше — лишние задачи убрать (сделанные отметки остаются в истории курса только у оставшихся)
  if tg_op = 'UPDATE' then
    delete from tasks where id = any(coalesce(old.task_ids, '{}')) and not (id = any(ids));
  end if;
  new.task_ids := ids;
  return new;
end $$;
drop trigger if exists p_med_tasks on p_meds;
create trigger p_med_tasks before insert or update of name, unit, amount, times, every_days, start_on, end_on, stopped_on, pet_id
  or delete on p_meds for each row execute function p_med_tasks();

-- ---------- схемы процедур ----------
-- пересчитать сроки шагов круга; всё сделано — следующий круг через repeat_months
create or replace function p_run_recalc(p_run uuid) returns void language plpgsql as $$
declare
  r p_runs; s p_steps; t tasks; sc p_schemes;
  base date; due date; all_done boolean := true; last_done date; total int := 0; first boolean := true;
  nid uuid;
begin
  select * into r from p_runs where id = p_run;
  if not found then return; end if;
  base := r.start_on;
  for s in select * from p_steps where run_id = p_run order by idx loop
    due := base + s.gap;
    if not first then total := total + s.gap; end if;
    first := false;
    if s.task_id is not null then
      select * into t from tasks where id = s.task_id;
      if found then
        s.done_on := t.done_on;
        if t.done_on is not null and t.due_date is not null then due := t.due_date; end if;
        if t.done_on is null and t.due_date is distinct from due then
          if s.due_on is not null and t.due_date is not null and t.due_date is distinct from s.due_on then
            due := t.due_date;   -- срок перенесли вручную (или утренняя проверка) — оставляем, следующие шаги от него
          else
            update tasks set due_date = due where id = t.id;
          end if;
        end if;
      end if;
    end if;
    update p_steps set due_on = due, done_on = s.done_on where id = s.id
      and (due_on is distinct from due or done_on is distinct from s.done_on);
    if s.done_on is null then all_done := false; else last_done := s.done_on; end if;
    base := coalesce(s.done_on, due);
  end loop;
  if last_done is null then all_done := false; end if;

  select * into sc from p_schemes where id = r.scheme_id;
  if all_done and sc.repeat_months is not null then
    if not exists (select 1 from p_runs where prev_run = r.id) then
      insert into p_runs (user_id, pet_id, scheme_id, name, start_on, prev_run)
      values (r.user_id, r.pet_id, r.scheme_id, r.name,
              (last_done + make_interval(months => sc.repeat_months))::date - total, r.id);
    end if;
  elsif not all_done then
    -- отметку отменили — несделанный следующий круг убрать
    delete from p_runs n where n.prev_run = r.id
      and not exists (select 1 from p_steps x where x.run_id = n.id and x.done_on is not null);
  end if;
end $$;

-- новый круг: шаги из схемы (если приложение не передало свои) и задачи
create or replace function p_run_init() returns trigger language plpgsql as $$
declare sc p_schemes; st jsonb; i int := 0; v_kind text := p_kind(new.pet_id); s p_steps; rem int;
begin
  select * into sc from p_schemes where id = new.scheme_id;
  rem := coalesce(sc.remind_days, 7);
  if not exists (select 1 from p_steps where run_id = new.id) and sc.id is not null then
    for st in select * from jsonb_array_elements(sc.steps) loop
      insert into p_steps (user_id, run_id, idx, title, gap)
      values (new.user_id, new.id, i, coalesce(st->>'t', 'Шаг'), greatest(coalesce((st->>'gap')::int, 0), 0));
      i := i + 1;
    end loop;
  end if;
  for s in select * from p_steps where run_id = new.id and task_id is null order by idx loop
    update p_steps set task_id = p_put_task(null, new.user_id, v_kind, s.title, new.name, new.start_on, rem) where id = s.id;
  end loop;
  perform p_run_recalc(new.id);
  return null;
end $$;
drop trigger if exists p_run_init on p_runs;
create trigger p_run_init after insert on p_runs for each row execute function p_run_init();

create or replace function p_run_moved() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform p_run_recalc(new.id);
  return null;
end $$;
drop trigger if exists p_run_moved on p_runs;
create trigger p_run_moved after update of start_on on p_runs for each row execute function p_run_moved();

-- шаг удалили (или весь круг) — его несделанная задача тоже уходит
drop function if exists p_step_drop() cascade;
drop trigger if exists p_step_drop on p_steps;
create trigger p_step_drop after delete on p_steps for each row execute function p_drop_old();

-- шаг отметили без задачи (задачу удалили в «Задачах») — пересчёт
create or replace function p_step_marked() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform p_run_recalc(new.run_id);
  return null;
end $$;
drop trigger if exists p_step_marked on p_steps;
create trigger p_step_marked after update of done_on, gap on p_steps for each row execute function p_step_marked();

-- задачу шага отметили / отменили / перенесли в «Задачах» — пересчёт круга
create or replace function p_task_changed() returns trigger language plpgsql as $$
declare rid uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  select run_id into rid from p_steps where task_id = new.id;
  if rid is not null then perform p_run_recalc(rid); end if;
  return null;
end $$;
drop trigger if exists p_task_changed on tasks;
create trigger p_task_changed after update of done_on, due_date on tasks for each row execute function p_task_changed();

grant execute on function p_run_recalc(uuid) to authenticated;
