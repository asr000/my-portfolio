-- Run AFTER 20261016_public_showcase.sql. Safe to rerun; never grants access to all registered users.
begin;

create table if not exists public.note_invitations (
  id uuid primary key,
  code_hash text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  valid_days integer not null check(valid_days in (7,30)),
  revoked_at timestamptz,
  redeemed_by uuid references auth.users(id),
  redeemed_at timestamptz
);
create table if not exists public.note_members (
  user_id uuid primary key references auth.users(id),
  invitation_id uuid not null unique references public.note_invitations(id),
  granted_at timestamptz not null default now()
);
create table if not exists public.note_invitation_attempts (
  user_id uuid primary key references auth.users(id),
  window_started_at timestamptz not null default now(),
  failures integer not null default 0
);
alter table public.note_invitations enable row level security;
alter table public.note_members enable row level security;
alter table public.note_invitation_attempts enable row level security;
revoke all on public.note_invitations, public.note_members, public.note_invitation_attempts from public, anon, authenticated;

-- Check database-owned membership and confirmed email, never editable user_metadata.
create or replace function public.can_write_notes()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_portfolio_author() or exists(
    select 1 from public.note_members m join auth.users u on u.id = m.user_id
    where m.user_id = (select auth.uid()) and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.can_write_notes() from public, anon, authenticated;
grant execute on function public.can_write_notes() to authenticated;

create or replace function public.note_access()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('is_author', public.is_portfolio_author(), 'can_write', public.can_write_notes(),
    'email_verified', exists(select 1 from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null));
$$;
revoke all on function public.note_access() from public, anon, authenticated;
grant execute on function public.note_access() to authenticated;

-- Code is generated with crypto.getRandomValues in the author's browser. Only SHA-256 is stored.
-- The stable id makes a lost response safe to retry with the same code and expiry.
create or replace function public.issue_note_invitation(p_id uuid, p_code text, p_days integer default 7)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  normalized text := upper(regexp_replace(coalesce(p_code,''),'[[:space:]-]','','g'));
  hashed text;
  invitation public.note_invitations%rowtype;
begin
  if not public.is_portfolio_author() then raise exception '只有网站作者可以生成邀请码。' using errcode='42501'; end if;
  if p_id is null or normalized !~ '^[0-9A-F]{32}$' or p_days is null or p_days not in (7,30) then
    raise exception '邀请码参数无效。';
  end if;
  hashed := encode(sha256(convert_to(normalized,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('note-invite:' || p_id::text,0));
  select * into invitation from public.note_invitations where id=p_id;
  if found then
    if invitation.created_by <> auth.uid() or invitation.code_hash <> hashed or invitation.valid_days <> p_days then
      raise exception '操作编号已用于另一份邀请，请重新生成。';
    end if;
  else
    insert into public.note_invitations(id,code_hash,created_by,expires_at,valid_days)
    values(p_id,hashed,auth.uid(),now()+make_interval(days=>p_days),p_days) returning * into invitation;
  end if;
  return jsonb_build_object('id',invitation.id,'created_at',invitation.created_at,'expires_at',invitation.expires_at,
    'revoked_at',invitation.revoked_at,'redeemed_at',invitation.redeemed_at);
end;
$$;
revoke all on function public.issue_note_invitation(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.issue_note_invitation(uuid,text,integer) to authenticated;

create or replace function public.list_note_invitations(p_before_created_at timestamptz default null, p_before_id uuid default null)
returns table(id uuid,created_at timestamptz,expires_at timestamptz,revoked_at timestamptz,redeemed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_portfolio_author() then raise exception '只有网站作者可以管理邀请码。' using errcode='42501'; end if;
  return query select i.id,i.created_at,i.expires_at,i.revoked_at,i.redeemed_at from public.note_invitations i
    where (p_before_created_at is null and p_before_id is null) or (i.created_at,i.id)<(p_before_created_at,p_before_id)
    order by i.created_at desc,i.id desc limit 21;
end;
$$;
revoke all on function public.list_note_invitations(timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.list_note_invitations(timestamptz,uuid) to authenticated;

create or replace function public.revoke_note_invitation(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare invitation public.note_invitations%rowtype;
begin
  if not public.is_portfolio_author() then raise exception '只有网站作者可以撤销邀请码。' using errcode='42501'; end if;
  select * into invitation from public.note_invitations where id=p_id for update;
  if not found then raise exception '邀请不存在。'; end if;
  if invitation.redeemed_at is not null then raise exception '邀请码已兑换，不能撤销。'; end if;
  update public.note_invitations set revoked_at=coalesce(revoked_at,now()) where id=p_id;
end;
$$;
revoke all on function public.revoke_note_invitation(uuid) from public, anon, authenticated;
grant execute on function public.revoke_note_invitation(uuid) to authenticated;

create or replace function public.redeem_note_invitation(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  normalized text := upper(regexp_replace(coalesce(p_code,''),'[[:space:]-]','','g'));
  invitation public.note_invitations%rowtype;
  attempts public.note_invitation_attempts%rowtype;
begin
  if actor is null then raise exception '请先登录。' using errcode='42501'; end if;
  if public.can_write_notes() then return jsonb_build_object('ok',true,'already_active',true); end if;
  if not exists(select 1 from auth.users u where u.id=actor and u.email_confirmed_at is not null) then
    raise exception '请先验证邮箱，再兑换邀请码。' using errcode='42501';
  end if;
  -- Serialize redemption per user and then lock the invitation: one code grants exactly one account.
  perform pg_advisory_xact_lock(hashtextextended('note-member:' || actor::text,0));
  if public.can_write_notes() then return jsonb_build_object('ok',true,'already_active',true); end if;
  insert into public.note_invitation_attempts(user_id) values(actor) on conflict do nothing;
  select * into attempts from public.note_invitation_attempts where user_id=actor for update;
  if attempts.window_started_at <= now()-interval '15 minutes' then
    update public.note_invitation_attempts set failures=0,window_started_at=now() where user_id=actor returning * into attempts;
  end if;
  if attempts.failures >= 5 then
    return jsonb_build_object('ok',false,'message','尝试次数较多，请在 15 分钟后重试。');
  end if;
  if normalized ~ '^[0-9A-F]{32}$' then
    select * into invitation from public.note_invitations
      where code_hash=encode(sha256(convert_to(normalized,'UTF8')),'hex') for update;
  end if;
  if invitation.id is null or invitation.revoked_at is not null or invitation.redeemed_at is not null or invitation.expires_at <= now() then
    -- Return an error result so the failed-attempt counter is committed instead of rolled back.
    update public.note_invitation_attempts set failures=failures+1 where user_id=actor;
    return jsonb_build_object('ok',false,'message','邀请码无效、已使用或已过期，请向网站作者获取新邀请码。');
  end if;
  insert into public.note_members(user_id,invitation_id) values(actor,invitation.id);
  update public.note_invitations set redeemed_by=actor,redeemed_at=now() where id=invitation.id;
  delete from public.note_invitation_attempts where user_id=actor;
  return jsonb_build_object('ok',true,'already_active',false);
end;
$$;
revoke all on function public.redeem_note_invitation(text) from public, anon, authenticated;
grant execute on function public.redeem_note_invitation(text) to authenticated;

-- Existing SECURITY DEFINER mutation APIs bypass RLS, so guard writes with a table trigger too.
create or replace function public.enforce_note_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Administrator SQL and service-role maintenance remain available. Browser users cannot select these roles.
  if current_setting('role',true) in ('anon','authenticated') and not coalesce(public.can_write_notes(),false) then
    raise exception '请先兑换邀请码，开通笔记记录功能。' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.enforce_note_membership() from public, anon, authenticated;
drop trigger if exists records_note_membership_guard on public.records;
create trigger records_note_membership_guard before insert or update or delete on public.records
  for each row execute function public.enforce_note_membership();

drop policy if exists record_covers_membership_insert on storage.objects;
create policy record_covers_membership_insert on storage.objects as restrictive for insert to authenticated
  with check(bucket_id<>'record-covers' or public.can_write_notes());
drop policy if exists record_covers_membership_update on storage.objects;
create policy record_covers_membership_update on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'record-covers' or public.can_write_notes()) with check(bucket_id<>'record-covers' or public.can_write_notes());
drop policy if exists record_covers_membership_delete on storage.objects;
create policy record_covers_membership_delete on storage.objects as restrictive for delete to authenticated
  using(bucket_id<>'record-covers' or public.can_write_notes());

notify pgrst, 'reload schema';
commit;
