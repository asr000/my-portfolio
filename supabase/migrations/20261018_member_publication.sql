-- Run AFTER 20261017_invitation_auth.sql. Safe to rerun.
-- No existing record is automatically published. Account emails stay private.
begin;

create table if not exists public.note_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (
    display_name = trim(display_name) and char_length(display_name) between 1 and 30
    and display_name !~ '[[:cntrl:]]'
  )
);
alter table public.note_profiles enable row level security;
revoke all on public.note_profiles from public, anon, authenticated;

-- These helpers are internal to the scoped APIs, never callable by website users.
create or replace function public.is_note_publisher(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.portfolio_site s where s.owner_id = p_user_id)
    or exists(select 1 from public.note_members m join auth.users u on u.id = m.user_id
      where m.user_id = p_user_id and u.email_confirmed_at is not null);
$$;
revoke all on function public.is_note_publisher(uuid) from public, anon, authenticated;

create or replace function public.note_author_source(p_user_id uuid)
returns table(author_name text, author_role text)
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.display_name from public.note_profiles p where p.user_id = p_user_id),
      case when exists(select 1 from public.portfolio_site s where s.owner_id = p_user_id)
        then '网站作者' else '笔记作者-' || left(md5(p_user_id::text), 10) end),
    case when exists(select 1 from public.portfolio_site s where s.owner_id = p_user_id)
      then 'owner' else 'member' end;
$$;
revoke all on function public.note_author_source(uuid) from public, anon, authenticated;

create or replace function public.note_profile()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not public.can_write_notes() then
    raise exception '请先兑换邀请码，开通笔记记录功能。' using errcode = '42501';
  end if;
  return (select jsonb_build_object('display_name', s.author_name, 'author_role', s.author_role)
    from public.note_author_source(actor) s);
end;
$$;
revoke all on function public.note_profile() from public, anon, authenticated;
grant execute on function public.note_profile() to authenticated;

create or replace function public.set_note_display_name(p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); name text := trim(p_display_name);
begin
  if actor is null or not public.can_write_notes() then
    raise exception '请先兑换邀请码，开通笔记记录功能。' using errcode = '42501';
  end if;
  if name is null or char_length(name) not between 1 and 30 or name ~ '[[:cntrl:]]' then
    raise exception '昵称需要 1 到 30 个字符，不能包含换行或控制字符。';
  end if;
  insert into public.note_profiles(user_id, display_name) values(actor, name)
    on conflict(user_id) do update set display_name = excluded.display_name;
  return public.note_profile();
end;
$$;
revoke all on function public.set_note_display_name(text) from public, anon, authenticated;
grant execute on function public.set_note_display_name(text) to authenticated;

create or replace function public.enforce_record_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null then new.is_public := false; end if;
  if new.is_public and not public.is_note_publisher(new.user_id) then
    raise exception '请先验证邮箱并兑换邀请码，再公开自己的笔记。' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_record_publication() from public, anon, authenticated;

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
  if actor is null or not public.can_write_notes() then
    raise exception '请先验证邮箱并兑换邀请码，再公开自己的笔记。' using errcode = '42501';
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

-- Return types gain attribution columns, so replace the two function definitions in this transaction.
drop function if exists public.public_records(text,text,timestamptz,uuid,integer);
create function public.public_records(
  p_query text default '', p_tag text default '',
  p_before_created_at timestamptz default null, p_before_id uuid default null,
  p_limit integer default 13
) returns table(id uuid, title text, tags text[], cover_path text, created_at timestamptz, updated_at timestamptz,
  author_name text, author_role text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.title, r.tags, r.cover_path, r.created_at, r.updated_at, s.author_name, s.author_role
  from public.records r cross join lateral public.note_author_source(r.user_id) s
  where r.is_public and r.deleted_at is null and public.is_note_publisher(r.user_id)
    and (coalesce(trim(p_query), '') = '' or strpos(lower(r.title), lower(left(trim(p_query),160))) > 0)
    and (coalesce(p_tag, '') = '' or r.tags @> array[p_tag])
    and ((p_before_created_at is null and p_before_id is null) or (r.created_at, r.id) < (p_before_created_at, p_before_id))
  order by r.created_at desc, r.id desc
  limit least(greatest(coalesce(p_limit,13),1),50);
$$;
revoke all on function public.public_records(text,text,timestamptz,uuid,integer) from public, anon, authenticated;
grant execute on function public.public_records(text,text,timestamptz,uuid,integer) to anon, authenticated;

drop function if exists public.public_record(uuid);
create function public.public_record(p_record_id uuid)
returns table(id uuid, title text, tags text[], content text, cover_path text, created_at timestamptz, updated_at timestamptz,
  author_name text, author_role text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.title, r.tags, r.content, r.cover_path, r.created_at, r.updated_at, s.author_name, s.author_role
  from public.records r cross join lateral public.note_author_source(r.user_id) s
  where r.id = p_record_id and r.is_public and r.deleted_at is null and public.is_note_publisher(r.user_id);
$$;
revoke all on function public.public_record(uuid) from public, anon, authenticated;
grant execute on function public.public_record(uuid) to anon, authenticated;

create or replace function public.public_record_tags()
returns table(tag text) language sql stable security definer set search_path = '' as $$
  select distinct unnest(r.tags) as tag from public.records r
  where r.is_public and r.deleted_at is null and public.is_note_publisher(r.user_id) order by tag;
$$;
revoke all on function public.public_record_tags() from public, anon, authenticated;
grant execute on function public.public_record_tags() to anon, authenticated;

create or replace function public.is_public_record_cover(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.records r where r.cover_path = p_name
    and r.is_public and r.deleted_at is null and public.is_note_publisher(r.user_id));
$$;
revoke all on function public.is_public_record_cover(text) from public, anon, authenticated;
grant execute on function public.is_public_record_cover(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
