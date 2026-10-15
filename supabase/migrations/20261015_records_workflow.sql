-- Run once in the Supabase SQL Editor before publishing this version.
-- Re-running is supported. Existing records and files are preserved.
begin;

alter table public.records add column if not exists updated_at timestamptz not null default now();
alter table public.records add column if not exists version integer not null default 1;
alter table public.records add column if not exists deleted_at timestamptz;
create index if not exists records_owner_page_idx on public.records(user_id, created_at desc, id desc);
create index if not exists records_tags_idx on public.records using gin(tags);

create table if not exists public.record_mutations (
  user_id uuid not null references auth.users(id),
  request_id uuid not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.record_mutations enable row level security;
revoke all on public.record_mutations from anon, authenticated;

alter table public.records enable row level security;
revoke all on public.records from anon, authenticated;
grant select on public.records to authenticated;
drop policy if exists read_own_records on public.records;
create policy read_own_records on public.records for select to authenticated
using ((select auth.uid()) = user_id);
drop policy if exists records_owner_boundary on public.records;
create policy records_owner_boundary on public.records as restrictive for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- All mutations are atomic and idempotent. Stale edits fail instead of overwriting.
create or replace function public.mutate_record(
  p_request_id uuid, p_action text, p_record_id uuid,
  p_version integer default null, p_title text default null,
  p_tags text[] default null, p_content text default null, p_cover_path text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_record public.records%rowtype;
  v_result jsonb;
  v_payload jsonb;
  v_previous public.record_mutations%rowtype;
begin
  if v_user is null then raise exception '请先登录。' using errcode = '42501'; end if;
  if p_request_id is null or p_record_id is null then raise exception '缺少操作编号。'; end if;
  if p_action is null or p_action not in ('create', 'update', 'trash', 'restore', 'purge') then raise exception '不支持的操作。'; end if;
  v_payload := jsonb_build_object('action', p_action, 'id', p_record_id, 'version', p_version,
    'title', p_title, 'tags', p_tags, 'content', p_content, 'cover_path', p_cover_path);
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || p_request_id::text, 0));
  select * into v_previous from public.record_mutations where user_id = v_user and request_id = p_request_id;
  if found then
    if v_previous.payload <> v_payload then raise exception '操作编号已用于另一份内容，请重新载入。'; end if;
    return v_previous.result;
  end if;

  if p_action in ('create', 'update') then
    if nullif(trim(p_title), '') is null or length(p_title) > 160 then raise exception '标题须为 1～160 个字符。'; end if;
    if length(coalesce(p_content, '')) > 100000 then raise exception '正文不能超过 100000 个字符。'; end if;
    if cardinality(coalesce(p_tags, '{}')) > 12 or exists (
      select 1 from unnest(p_tags) t where t is null or length(trim(t)) = 0 or length(t) > 24
    ) then raise exception '最多 12 个标签，每个标签 1～24 个字符。'; end if;
    if p_cover_path is not null then
      if split_part(p_cover_path, '/', 1) <> v_user::text then raise exception '封面不属于当前账号。' using errcode = '42501'; end if;
      if not exists (select 1 from storage.objects where bucket_id = 'record-covers' and name = p_cover_path) then
        raise exception '封面文件不存在，请重新上传。';
      end if;
    end if;
  end if;

  if p_action = 'create' then
    insert into public.records(id, user_id, title, tags, content, cover_path)
    values(p_record_id, v_user, trim(p_title), coalesce(p_tags, '{}'), coalesce(p_content, ''), p_cover_path)
    returning * into v_record;
    v_result := jsonb_build_object('record', to_jsonb(v_record), 'old_cover_path', null);
  else
    select * into v_record from public.records where id = p_record_id and user_id = v_user for update;
    if not found then raise exception '记录不存在或没有访问权限。' using errcode = '42501'; end if;
    if p_version is distinct from v_record.version then
      raise exception '记录已在其他页面或设备修改，请保留草稿并重新载入。' using errcode = '40001';
    end if;
    if p_action in ('update', 'trash') and v_record.deleted_at is not null then raise exception '记录已在回收站。'; end if;
    if p_action in ('restore', 'purge') and v_record.deleted_at is null then raise exception '请先移入回收站。'; end if;
    v_result := jsonb_build_object('old_cover_path', case when p_action in ('update', 'purge') then v_record.cover_path else null end);
    if p_action = 'purge' then
      delete from public.records where id = p_record_id;
      v_result := v_result || jsonb_build_object('record', null, 'id', p_record_id);
    else
      update public.records set
        title = case when p_action = 'update' then trim(p_title) else title end,
        tags = case when p_action = 'update' then coalesce(p_tags, '{}') else tags end,
        content = case when p_action = 'update' then coalesce(p_content, '') else content end,
        cover_path = case when p_action = 'update' then p_cover_path else cover_path end,
        deleted_at = case when p_action = 'trash' then now() when p_action = 'restore' then null else deleted_at end,
        version = version + 1, updated_at = now()
      where id = p_record_id returning * into v_record;
      v_result := v_result || jsonb_build_object('record', to_jsonb(v_record));
    end if;
  end if;
  insert into public.record_mutations(user_id, request_id, payload, result) values(v_user, p_request_id, v_payload, v_result);
  return v_result;
end;
$$;
revoke all on function public.mutate_record(uuid,text,uuid,integer,text,text[],text,text) from public, anon;
grant execute on function public.mutate_record(uuid,text,uuid,integer,text,text[],text,text) to authenticated;

create or replace function public.record_tags(p_trash boolean default false)
returns table(tag text) language sql stable security invoker set search_path = '' as $$
  select distinct unnest(r.tags) as tag from public.records r
  where r.user_id = (select auth.uid()) and (r.deleted_at is not null) = p_trash order by tag;
$$;
revoke all on function public.record_tags(boolean) from public, anon;
grant execute on function public.record_tags(boolean) to authenticated;

-- Retain files used by any live OR trashed record. Only unreferenced own files can be removed.
drop policy if exists record_covers_owner_boundary on storage.objects;
create policy record_covers_owner_boundary on storage.objects as restrictive for all to authenticated
using (bucket_id <> 'record-covers' or (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id <> 'record-covers' or (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists record_covers_reference_boundary on storage.objects;
create policy record_covers_reference_boundary on storage.objects as restrictive for delete to authenticated
using (bucket_id <> 'record-covers' or not exists(select 1 from public.records r where r.cover_path = storage.objects.name));
drop policy if exists delete_unused_record_covers on storage.objects;
create policy delete_unused_record_covers on storage.objects for delete to authenticated
using (bucket_id = 'record-covers' and (storage.foldername(name))[1] = (select auth.uid())::text
  and not exists(select 1 from public.records r where r.cover_path = storage.objects.name));

notify pgrst, 'reload schema';
commit;
