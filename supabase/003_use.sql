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
