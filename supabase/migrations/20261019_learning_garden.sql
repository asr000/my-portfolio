-- Run AFTER 20261018_member_publication.sql. Safe to rerun.
-- A publication day means the first public release of at least one new note.
-- Days use Asia/Taipei (UTC+8), independently of the visitor's device clock.
begin;

create table if not exists public.note_first_publications (
  record_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  published_at timestamptz not null,
  published_day date not null
);
create index if not exists note_publication_days_idx
  on public.note_first_publications(user_id, published_day);
alter table public.note_first_publications enable row level security;
revoke all on public.note_first_publications from public, anon, authenticated;

-- Preserve proven historical publication dates, including notes later unpublished
-- or deleted. Never infer a publication date from a private note's creation date.
insert into public.note_first_publications(record_id, user_id, published_at, published_day)
select distinct on ((m.payload->>'id')::uuid)
  (m.payload->>'id')::uuid, m.user_id, m.created_at,
  (m.created_at at time zone 'Asia/Taipei')::date
from public.record_mutations m
where m.payload->>'action' = 'publish'
  and m.result->'record'->>'is_public' = 'true'
order by (m.payload->>'id')::uuid, m.created_at
on conflict(record_id) do nothing;

create or replace function public.track_first_note_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not new.is_public or new.deleted_at is not null then return new; end if;
  if tg_op = 'UPDATE' and old.is_public then return new; end if;
  insert into public.note_first_publications(record_id, user_id, published_at, published_day)
    values(new.id, new.user_id, statement_timestamp(),
      (statement_timestamp() at time zone 'Asia/Taipei')::date)
    on conflict(record_id) do nothing;
  return new;
end;
$$;
revoke all on function public.track_first_note_publication() from public, anon, authenticated;
create or replace trigger records_first_publication after insert or update of is_public on public.records
  for each row execute function public.track_first_note_publication();

create table if not exists public.note_daily_checkins (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  fortune_index smallint not null check (fortune_index between 0 and 11),
  created_at timestamptz not null default now(),
  primary key(user_id, day)
);
alter table public.note_daily_checkins enable row level security;
revoke all on public.note_daily_checkins from public, anon, authenticated;

create or replace function public.note_garden_progress()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  subject uuid := coalesce(actor, (select owner_id from public.portfolio_site));
  today date := (statement_timestamp() at time zone 'Asia/Taipei')::date;
begin
  return jsonb_build_object(
    'scope', case when actor is null then 'owner' else 'self' end,
    'day', today,
    'publish_days', (select count(distinct published_day) from public.note_first_publications where user_id = subject),
    'published_today', exists(select 1 from public.note_first_publications where user_id = subject and published_day = today),
    'checkin_days', case when actor is null then 0 else (select count(*) from public.note_daily_checkins where user_id = actor) end,
    'fortune_index', (select fortune_index from public.note_daily_checkins where user_id = actor and day = today),
    'can_check_in', exists(select 1 from auth.users where id = actor and email_confirmed_at is not null)
  );
end;
$$;
revoke all on function public.note_garden_progress() from public, anon, authenticated;
grant execute on function public.note_garden_progress() to anon, authenticated;

create or replace function public.draw_daily_note_fortune()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  today date := (statement_timestamp() at time zone 'Asia/Taipei')::date;
begin
  if actor is null or not exists(select 1 from auth.users where id = actor and email_confirmed_at is not null) then
    raise exception '请先登录并验证邮箱，再来抽取今日签。' using errcode = '42501';
  end if;
  insert into public.note_daily_checkins(user_id, day, fortune_index)
    values(actor, today, floor(random() * 12)::smallint)
    on conflict(user_id, day) do nothing;
  return public.note_garden_progress();
end;
$$;
revoke all on function public.draw_daily_note_fortune() from public, anon, authenticated;
grant execute on function public.draw_daily_note_fortune() to authenticated;

create or replace function public.public_learning_garden()
returns jsonb language sql stable security definer set search_path = '' as $$
  with visible as (
    select r.id, r.tags from public.records r
    where r.is_public and r.deleted_at is null and public.is_note_publisher(r.user_id)
  ), plants as (
    select t.tag, count(distinct v.id) as count
    from visible v cross join lateral unnest(v.tags) as t(tag)
    group by t.tag order by count(distinct v.id) desc, t.tag limit 4
  )
  select jsonb_build_object('total', (select count(*) from visible),
    'plants', coalesce((select jsonb_agg(jsonb_build_object('tag', tag, 'count', count)
      order by count desc, tag) from plants), '[]'::jsonb));
$$;
revoke all on function public.public_learning_garden() from public, anon, authenticated;
grant execute on function public.public_learning_garden() to anon, authenticated;

notify pgrst, 'reload schema';
commit;
