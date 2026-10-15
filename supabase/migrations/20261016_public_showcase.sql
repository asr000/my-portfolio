-- Run AFTER 20261015_records_workflow.sql. Safe to rerun.
-- Existing records remain private. No record is published by this migration.
begin;

alter table public.records add column if not exists is_public boolean not null default false;
alter table public.records enable row level security;
revoke all on public.records from anon, authenticated;
grant select on public.records to authenticated;
drop policy if exists records_owner_boundary on public.records;
create policy records_owner_boundary on public.records as restrictive for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create index if not exists records_showcase_page_idx on public.records(created_at desc, id desc)
  where is_public and deleted_at is null;

-- The website has one author. Visitors cannot nominate themselves as its author.
create table if not exists public.portfolio_site (
  singleton boolean primary key default true check (singleton),
  owner_id uuid not null references auth.users(id)
);
alter table public.portfolio_site enable row level security;
revoke all on public.portfolio_site from public, anon, authenticated;

do $$
declare
  -- Only fill this when the automatic account check reports multiple possible authors.
  author_email text := '';
  candidates uuid[];
  author_id uuid;
begin
  if not exists(select 1 from storage.buckets where id = 'record-covers') then
    raise exception '请先创建 record-covers 私有存储桶。';
  end if;
  if exists(select 1 from storage.buckets where id = 'record-covers' and public) then
    raise exception 'record-covers 当前为 Public。请改为 Private 后重试，以保护私密封面。';
  end if;
  if exists(select 1 from public.portfolio_site) then return; end if;
  if author_email <> '' then
    select id into author_id from auth.users where lower(email) = lower(trim(author_email));
    if author_id is null then raise exception 'author_email 对应的账号不存在。'; end if;
  else
    select array_agg(distinct user_id) into candidates from public.records;
    if coalesce(cardinality(candidates), 0) = 0 then
      select array_agg(id) into candidates from auth.users;
    end if;
    if coalesce(cardinality(candidates), 0) <> 1 then
      raise exception '无法唯一确定网站作者。请在脚本开头的 author_email 填写你的登录邮箱，再完整运行。';
    end if;
    author_id := candidates[1];
  end if;
  insert into public.portfolio_site(singleton, owner_id) values(true, author_id);
end;
$$;

create or replace function public.is_portfolio_author()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.portfolio_site s where s.owner_id = (select auth.uid()));
$$;
revoke all on function public.is_portfolio_author() from public, anon, authenticated;
grant execute on function public.is_portfolio_author() to authenticated;

-- This trigger also runs for the existing mutation function. Restoring never republishes.
create or replace function public.enforce_record_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null then new.is_public := false; end if;
  if new.is_public and not exists(select 1 from public.portfolio_site s where s.owner_id = new.user_id) then
    raise exception '只有网站作者的记录可以公开展示。' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_record_publication() from public, anon, authenticated;
drop trigger if exists records_publication_guard on public.records;
create trigger records_publication_guard before insert or update on public.records
  for each row execute function public.enforce_record_publication();

create or replace function public.set_record_visibility(
  p_request_id uuid, p_record_id uuid, p_version integer, p_public boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  record public.records%rowtype;
  previous public.record_mutations%rowtype;
  payload jsonb;
  result jsonb;
begin
  if actor is null or not public.is_portfolio_author() then
    raise exception '只有网站作者可以设置公开展示。' using errcode = '42501';
  end if;
  if p_request_id is null or p_record_id is null or p_public is null then raise exception '缺少公开设置参数。'; end if;
  payload := jsonb_build_object('action', case when p_public then 'publish' else 'unpublish' end,
    'id', p_record_id, 'version', p_version);
  perform pg_advisory_xact_lock(hashtextextended(actor::text || p_request_id::text, 0));
  select * into previous from public.record_mutations where user_id = actor and request_id = p_request_id;
  if found then
    if previous.payload <> payload then raise exception '操作编号已用于另一份内容，请重新载入。'; end if;
    return previous.result;
  end if;
  select * into record from public.records where id = p_record_id and user_id = actor for update;
  if not found then raise exception '记录不存在或没有访问权限。' using errcode = '42501'; end if;
  if p_version is distinct from record.version then
    raise exception '记录已在其他页面或设备修改，请重新载入。' using errcode = '40001';
  end if;
  if record.deleted_at is not null then raise exception '回收站中的记录不能设置公开。'; end if;
  update public.records set is_public = p_public, version = version + 1, updated_at = now()
    where id = p_record_id returning * into record;
  result := jsonb_build_object('record', to_jsonb(record), 'old_cover_path', null);
  insert into public.record_mutations(user_id, request_id, payload, result) values(actor, p_request_id, payload, result);
  return result;
end;
$$;
revoke all on function public.set_record_visibility(uuid,uuid,integer,boolean) from public, anon, authenticated;
grant execute on function public.set_record_visibility(uuid,uuid,integer,boolean) to authenticated;

-- These narrowly scoped read APIs intentionally bypass owner RLS only for published fields.
-- Direct table access, private record tags and backup access retain their existing owner rules.
create or replace function public.public_records(
  p_query text default '', p_tag text default '',
  p_before_created_at timestamptz default null, p_before_id uuid default null,
  p_limit integer default 13
) returns table(id uuid, title text, tags text[], cover_path text, created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.title, r.tags, r.cover_path, r.created_at, r.updated_at
  from public.records r join public.portfolio_site s on s.owner_id = r.user_id
  where r.is_public and r.deleted_at is null
    and (coalesce(trim(p_query), '') = '' or strpos(lower(r.title), lower(left(trim(p_query),160))) > 0)
    and (coalesce(p_tag, '') = '' or r.tags @> array[p_tag])
    and ((p_before_created_at is null and p_before_id is null) or (r.created_at, r.id) < (p_before_created_at, p_before_id))
  order by r.created_at desc, r.id desc
  limit least(greatest(coalesce(p_limit,13),1),50);
$$;
revoke all on function public.public_records(text,text,timestamptz,uuid,integer) from public, anon, authenticated;
grant execute on function public.public_records(text,text,timestamptz,uuid,integer) to anon, authenticated;

create or replace function public.public_record(p_record_id uuid)
returns table(id uuid, title text, tags text[], content text, cover_path text, created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.title, r.tags, r.content, r.cover_path, r.created_at, r.updated_at
  from public.records r join public.portfolio_site s on s.owner_id = r.user_id
  where r.id = p_record_id and r.is_public and r.deleted_at is null;
$$;
revoke all on function public.public_record(uuid) from public, anon, authenticated;
grant execute on function public.public_record(uuid) to anon, authenticated;

create or replace function public.public_record_tags()
returns table(tag text) language sql stable security definer set search_path = '' as $$
  select distinct unnest(r.tags) as tag
  from public.records r join public.portfolio_site s on s.owner_id = r.user_id
  where r.is_public and r.deleted_at is null order by tag;
$$;
revoke all on function public.public_record_tags() from public, anon, authenticated;
grant execute on function public.public_record_tags() to anon, authenticated;

create or replace function public.is_public_record_cover(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.records r join public.portfolio_site s on s.owner_id = r.user_id
    where r.cover_path = p_name and r.is_public and r.deleted_at is null);
$$;
revoke all on function public.is_public_record_cover(text) from public, anon, authenticated;
grant execute on function public.is_public_record_cover(text) to anon, authenticated;

-- Split the old ALL boundary: published files become readable, never writable, by visitors.
drop policy if exists record_covers_owner_boundary on storage.objects;
drop policy if exists record_covers_read_boundary on storage.objects;
create policy record_covers_read_boundary on storage.objects as restrictive for select to anon, authenticated
using (bucket_id <> 'record-covers' or (storage.foldername(name))[1] = (select auth.uid())::text or public.is_public_record_cover(name));
drop policy if exists record_covers_insert_boundary on storage.objects;
create policy record_covers_insert_boundary on storage.objects as restrictive for insert to anon, authenticated
with check (bucket_id <> 'record-covers' or (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists record_covers_update_boundary on storage.objects;
create policy record_covers_update_boundary on storage.objects as restrictive for update to anon, authenticated
using (bucket_id <> 'record-covers' or (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id <> 'record-covers' or (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists record_covers_delete_boundary on storage.objects;
create policy record_covers_delete_boundary on storage.objects as restrictive for delete to anon, authenticated
using (bucket_id <> 'record-covers' or (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists read_published_record_covers on storage.objects;
create policy read_published_record_covers on storage.objects for select to anon, authenticated
using (bucket_id = 'record-covers' and public.is_public_record_cover(name));
grant select on storage.objects to anon;

notify pgrst, 'reload schema';
commit;
