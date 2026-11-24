-- ПРОБА 003_use.sql: делает всё по-настоящему, показывает итог красной «ошибкой» и всё отменяет — база не меняется.
-- Красный текст «ПРОБА окончена…» — это не поломка, а итог: прислать его Claude.
-- Вставить целиком в Supabase → SQL Editor → Run.
begin;
create temp table proba_n on commit drop as select (select count(*) from tasks) as tasks, (select count(*) from p_visits) as visits, (select count(*) from p_periods) as periods;

-- ===== тот же текст, что в 003_use.sql =====
-- Обновление 3: «Что используем» (свои блоки, бренд, картинка, «покупали»), прививки в приёме,
-- задача «Записаться» за месяц, скрытая вкладка «Процедуры и лекарства».
-- Сначала «003_use — проба.sql». Потом вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.
-- Нужны 001_pets.sql и 002_bday_fix.sql.

-- ---------- новые таблицы ----------
-- свои блоки наравне с кормом и наполнителем (у записей в них type = 'other')
create table if not exists p_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  pet_id uuid not null references p_pets on delete cascade,
  name text not null,
  icon text,
  ord int not null default 0,
  created_at timestamptz not null default now()
);
-- картинки: уменьшенные, прямо в базе (попадают в копию облака); отдельно, чтобы не грузить их каждый раз
create table if not exists p_pics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  pet_id uuid not null references p_pets on delete cascade,
  data text not null check (length(data) < 300000 and data like 'data:image/%'),
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['p_blocks', 'p_pics'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists own on %I', t);
    execute format('create policy own on %I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and exists (select 1 from p_pets p where p.id = pet_id and p.user_id = auth.uid()))', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('revoke all on %I from anon', t);
  end loop;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'p_blocks') then
    alter publication supabase_realtime add table p_blocks;
  end if;
end $$;

-- ---------- новые колонки ----------
alter table p_periods add column if not exists block_id uuid references p_blocks;   -- блок с записями не удаляется
alter table p_periods add column if not exists brand text;
alter table p_periods add column if not exists bought_on date;                       -- покупали последний раз
alter table p_periods add column if not exists pic_id uuid references p_pics on delete set null;

alter table p_visits add column if not exists vax_complex text;    -- комплексная прививка
alter table p_visits add column if not exists vax_rabies text;     -- от бешенства
alter table p_visits add column if not exists prep_days int default 30 check (prep_days is null or prep_days between 0 and 180);
alter table p_visits add column if not exists prep_task uuid references tasks on delete set null;
alter table p_visits add column if not exists prep_on date;

alter table p_schemes add column if not exists prep_days int default 30 check (prep_days is null or prep_days between 0 and 180);
alter table p_runs add column if not exists prep_task uuid references tasks on delete set null;
alter table p_runs add column if not exists prep_on date;

alter table p_pets add column if not exists show_proc boolean not null default false;   -- вкладка «Процедуры и лекарства»

-- «Другое» → блок «Препараты перед прививкой» (решение Юли 24.11.2026); повторный запуск ничего не меняет
insert into p_blocks (user_id, pet_id, name, icon)
select distinct p.user_id, p.pet_id, 'Препараты перед прививкой', '📦' from p_periods p
where p.type = 'other' and p.block_id is null
  and not exists (select 1 from p_blocks b where b.pet_id = p.pet_id and b.name = 'Препараты перед прививкой');
update p_periods p set block_id = b.id from p_blocks b
where p.type = 'other' and p.block_id is null and b.pet_id = p.pet_id and b.name = 'Препараты перед прививкой';

-- ---------- задача «Записаться» заранее ----------
-- приём: за prep_days дней до «следующего приёма». Осталось меньше — не создаётся. Сделанная не возвращается,
-- перенесённую вручную не трогаем.
create or replace function p_visit_prep() returns trigger language plpgsql set search_path = public as $$
declare v_on date; v_title text; t tasks;
begin
  if tg_op = 'UPDATE' and new.next_on is not distinct from old.next_on and new.prep_days is not distinct from old.prep_days
     and new.next_why is not distinct from old.next_why then
    return new;
  end if;
  v_on := new.next_on - nullif(new.prep_days, 0);
  if v_on is null or v_on < current_date then
    new.prep_task := null; new.prep_on := null;   -- несделанную задачу уберёт p_prep_gone (after)
    return new;
  end if;
  v_title := 'Записаться: ' || coalesce(nullif(new.next_why, ''), nullif(new.reason, ''), 'приём') || ' (к ' || to_char(new.next_on, 'DD.MM') || ')';
  select * into t from tasks where id = new.prep_task;
  if found then
    if t.done_on is null then
      update tasks set title = v_title,
        due_date = case when t.due_date is not distinct from old.prep_on then v_on else t.due_date end
      where id = t.id;
    end if;
  else
    new.prep_task := p_put_task(null, new.user_id, p_kind(new.pet_id), v_title, nullif(new.clinic, ''), v_on, 0);
  end if;
  new.prep_on := v_on;
  return new;
end $$;
drop trigger if exists p_visit_prep on p_visits;
create trigger p_visit_prep before insert or update on p_visits for each row execute function p_visit_prep();

-- схема: за prep_days дней до последнего шага круга
create or replace function p_run_prep(p_run uuid, p_new boolean) returns void language plpgsql set search_path = public as $$
declare r p_runs; sc p_schemes; last p_steps; t tasks; v_on date; v_title text;
begin
  select * into r from p_runs where id = p_run;
  if not found then return; end if;
  select * into sc from p_schemes where id = r.scheme_id;
  select * into last from p_steps where run_id = p_run order by idx desc limit 1;
  if not found then return; end if;
  -- круг закончен — несделанное «Записаться» не нужно
  if last.done_on is not null then
    if r.prep_task is not null then
      update p_runs set prep_task = null, prep_on = null where id = p_run;
    end if;
    return;
  end if;
  v_on := last.due_on - nullif(sc.prep_days, 0);
  if v_on is null or v_on < current_date then return; end if;
  v_title := 'Записаться: ' || r.name || ' (' || lower(last.title) || ' ' || to_char(last.due_on, 'DD.MM') || ')';
  select * into t from tasks where id = r.prep_task;
  if found then
    if t.done_on is null and r.prep_on is distinct from v_on then
      update tasks set title = v_title,
        due_date = case when t.due_date is not distinct from r.prep_on then v_on else t.due_date end
      where id = t.id;
      update p_runs set prep_on = v_on where id = p_run;
    end if;
  elsif p_new and not exists (select 1 from p_steps where run_id = p_run and done_on is not null) then
    update p_runs set prep_task = p_put_task(null, r.user_id, p_kind(r.pet_id), v_title, r.name, v_on, 0), prep_on = v_on where id = p_run;
  end if;
end $$;
revoke all on function p_run_prep(uuid, boolean) from public, anon;
grant execute on function p_run_prep(uuid, boolean) to authenticated;

-- имена триггеров — после p_run_init и p_run_moved (Postgres запускает по алфавиту)
create or replace function p_run_prep_new() returns trigger language plpgsql set search_path = public as $$
begin perform p_run_prep(new.id, true); return null; end $$;
drop trigger if exists p_run_zprep on p_runs;
create trigger p_run_zprep after insert or update of start_on on p_runs for each row execute function p_run_prep_new();
create or replace function p_step_prep() returns trigger language plpgsql set search_path = public as $$
begin perform p_run_prep(new.run_id, false); return null; end $$;
drop trigger if exists p_step_zprep on p_steps;
create trigger p_step_zprep after update of due_on, done_on on p_steps for each row execute function p_step_prep();

-- отвязали или удалили приём/круг — несделанная задача уходит
create or replace function p_prep_gone() returns trigger language plpgsql set search_path = public as $$
begin
  if old.prep_task is not null then
    if tg_op = 'DELETE' then
      perform p_drop_task(old.prep_task);
    elsif new.prep_task is distinct from old.prep_task then
      perform p_drop_task(old.prep_task);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists p_prep_gone on p_visits;
create trigger p_prep_gone after update or delete on p_visits for each row execute function p_prep_gone();
drop trigger if exists p_prep_gone on p_runs;
create trigger p_prep_gone after update or delete on p_runs for each row execute function p_prep_gone();

-- ===== проверки =====
do $$
declare
  pet uuid; u uuid; v uuid; sc uuid; rn uuid; n0 int; n1 int; blk int; inblk int; free int; names text; food text; foreign_n int; r text := ''; k int; tid uuid;
begin
  select p.id, p.user_id into pet, u from p_pets p where p.kind = 'cat' order by p.created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  select tasks into n0 from proba_n;
  select count(*) into n1 from tasks;
  r := r || case when n0 = n1 then ' задач не прибавилось ок;' else format(' ОШИБКА задач было %s, стало %s;', n0, n1) end;
  r := r || case when (select visits from proba_n) = (select count(*) from p_visits) and (select periods from proba_n) = (select count(*) from p_periods) then ' приёмы и корм целы ок;' else ' ОШИБКА приёмы/корм;' end;
  select count(*) into blk from p_blocks;
  select count(*), string_agg(name, ', ') into inblk, names from p_periods where block_id is not null;
  select count(*) into free from p_periods where type = 'other' and block_id is null;
  select string_agg(p.name || ' до ' || coalesce(p.check_on::text, '—') || ', задача: ' || coalesce(t.title || ' ' || t.due_date, 'НЕТ'), '; ') into food
    from p_periods p left join tasks t on t.id = p.task_id where p.type = 'food' and p.end_on is null;
  -- приём с датой через 180 дней → «Записаться» через 150; удалили — ушла
  insert into p_visits (user_id, pet_id, day, reason, next_on, next_why) values (u, pet, current_date, 'ПРОБА', current_date + 180, 'ПРОБА анализы') returning id, prep_task into v, tid;
  select due_date - current_date into k from tasks where id = tid;
  r := r || case when k = 150 then ' записаться к приёму ок;' else format(' ОШИБКА записаться %s;', k) end;
  delete from p_visits where id = v;
  r := r || case when not exists (select 1 from tasks where title like '%ПРОБА%') then ' удаление ок;' else ' ОШИБКА удаление;' end;
  -- схема: 60 + 15 − 30 = 45
  insert into p_schemes (user_id, pet_id, name, steps, repeat_months) values (u, pet, 'ПРОБА схема', '[{"t":"А","gap":0},{"t":"Б","gap":5},{"t":"В","gap":10}]', 11) returning id into sc;
  insert into p_runs (user_id, pet_id, scheme_id, name, start_on) values (u, pet, sc, 'ПРОБА схема', current_date + 60) returning id into rn;
  select t.due_date - current_date into k from p_runs x join tasks t on t.id = x.prep_task where x.id = rn;
  r := r || case when k = 45 then ' записаться к прививке ок;' else format(' ОШИБКА схема %s;', k) end;
  delete from p_runs where id = rn;
  r := r || case when not exists (select 1 from tasks where title like '%ПРОБА%' or notes like '%ПРОБА%') then ' круг удалён ок;' else ' ОШИБКА круг;' end;
  -- чужой вход ничего не видит
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select (select count(*) from p_blocks) + (select count(*) from p_pics) into foreign_n;
  raise exception 'ПРОБА окончена, всё отменено.% Блоков: % (ждём 1); в блоке: % — % ; «Другое» без блока: % (ждём 0); корм: %; чужой видит: % (ждём 0)',
    r, blk, inblk, names, free, food, foreign_n;
end $$;
rollback;
