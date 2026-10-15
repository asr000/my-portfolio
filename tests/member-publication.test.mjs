import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ID = '11111111-1111-4111-8111-111111111111'
const BID = '22222222-2222-4222-8222-222222222222'
const CID = '33333333-3333-4333-8333-333333333333'
const cover = `${B}/public.png`
const code = '0123456789ABCDEF0123456789ABCDEF'
const migrations = await Promise.all([
  '20261015_records_workflow.sql', '20261016_public_showcase.sql',
  '20261017_invitation_auth.sql', '20261018_member_publication.sql',
].map((name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')))

test('members publish only their own notes and public attribution exposes no private account data', async (t) => {
  const db = new PGlite()
  const login = (id = A, role = 'authenticated') => db.exec(
    `reset role; select set_config('request.jwt.claim.sub','${id}',false); set role ${role};`,
  )
  const rpc = async (sql, args = []) => (await db.query(`select ${sql} as result`, args)).rows[0].result
  const visible = (id, version, value, request = crypto.randomUUID()) =>
    rpc('set_record_visibility($1,$2,$3,$4)', [request, id, version, value])
  const detail = async (id) => (await db.query('select * from public_record($1)', [id])).rows
  const list = async () => (await db.query('select * from public_records()')).rows
  const nickname = (name) => rpc('set_note_display_name($1)', [name])
  const mutate = (action, version) => rpc('mutate_record($1,$2,$3,$4)', [
    crypto.randomUUID(), action, BID, version,
  ])
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
      insert into auth.users values('${A}','private-owner@example.invalid',now(),'{}'),
        ('${B}','private-member@example.invalid',now(),'{}'),
        ('${C}','private-reader@example.invalid',now(),'{"is_author":true,"can_write":true}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth,storage to anon,authenticated;
      create table storage.buckets(id text primary key,public boolean default false);
      insert into storage.buckets values('record-covers',false);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
      create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
      alter table storage.objects enable row level security;
      grant select,insert,update,delete on storage.objects to authenticated;
      create policy legacy_allow_all on storage.objects for all to anon,authenticated using(true) with check(true);
      create table records(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),title text not null,tags text[] not null default '{}',content text not null default '',cover_path text,created_at timestamptz not null default now());
      insert into records(id,user_id,title) values('${ID}','${A}','作者已有的公开笔记');
    `)
    for (const sql of migrations.slice(0, 3)) await db.exec(sql)
    await login()
    await visible(ID, 1, true)
    await db.exec(`reset role;
      insert into records(id,user_id,title,tags,content,cover_path) values
        ('${BID}','${B}','受邀用户的笔记','{共享标签}','成员正文','${cover}'),
        ('${CID}','${C}','未受邀的旧笔记','{私密标签}','私密正文',null);
      insert into storage.objects(bucket_id,name) values('record-covers','${cover}'),('record-covers','${B}/private.png');
    `)
    await db.exec(migrations[3])
    await db.exec(migrations[3])
    await t.test('upgrade preserves existing publication and never publishes other private notes', async () => {
      await login('', 'anon')
      assert.deepEqual((await list()).map((r) => r.id), [ID])
      assert.deepEqual(await detail(BID), [])
      const owner = (await detail(ID))[0]
      assert.equal(owner.author_name, '网站作者')
      assert.equal(owner.author_role, 'owner')
      assert.equal((await db.query('select * from storage.objects')).rows.length, 0)
    })
    await t.test('registration and forged metadata cannot grant publication or profile editing', async () => {
      await login(C)
      await assert.rejects(visible(CID, 1, true), /验证邮箱并兑换邀请码/)
      await assert.rejects(nickname('冒充作者'), /兑换邀请码/)
      await assert.rejects(rpc('note_profile()'), /兑换邀请码/)
      await db.exec('reset role')
      await assert.rejects(db.query('update records set is_public=true where id=$1', [CID]), /兑换邀请码/)
    })
    await t.test('a newly redeemed member publishes with version and idempotent retry checks', async () => {
      await login()
      await rpc('issue_note_invitation($1,$2,7)', [crypto.randomUUID(), code])
      await login(B)
      assert.equal((await rpc('redeem_note_invitation($1)', [code])).ok, true)
      const profile = await rpc('note_profile()')
      assert.match(profile.display_name, /^笔记作者-[a-f0-9]{10}$/)
      assert.equal(profile.author_role, 'member')
      const request = crypto.randomUUID()
      const published = await visible(BID, 1, true, request)
      assert.equal(published.record.is_public, true)
      assert.equal(published.record.version, 2)
      assert.deepEqual(await visible(BID, 1, true, request), published)
      await assert.rejects(visible(BID, 2, false, request), /操作编号/)
      await assert.rejects(visible(BID, 1, false), /其他页面或设备/)
      await assert.rejects(visible(ID, 2, false), /没有访问权限/)
      await login()
      await assert.rejects(visible(BID, 2, false), /没有访问权限/)
    })
    await t.test('nicknames change only the current account; role labels remain database controlled', async () => {
      await login()
      await nickname('站长')
      await login(B)
      for (const name of ['', '   ', 'x'.repeat(31), '名字\n换行', '名字\t制表'])
        await assert.rejects(nickname(name), /昵称需要/)
      assert.deepEqual(await nickname('  小明的练习  '), { display_name: '小明的练习', author_role: 'member' })
      assert.equal((await detail(ID))[0].author_name, '站长')
      await nickname('网站作者')
      assert.equal((await detail(BID))[0].author_role, 'member')
      await nickname('小明的练习')
      await assert.rejects(db.query('update note_profiles set display_name=$1', ['修改别人']), /permission denied/)
      await assert.rejects(db.query('select * from note_profiles'), /permission denied/)
      await assert.rejects(rpc('note_author_source($1)', [A]), /permission denied/)
      await assert.rejects(rpc('is_note_publisher($1)', [A]), /permission denied/)
    })
    await t.test('anonymous list, detail, tags and covers include invited authors without account details', async () => {
      await login('', 'anon')
      const rows = await list()
      assert.equal(rows.length, 2)
      const member = (await detail(BID))[0]
      assert.equal(member.author_name, '小明的练习')
      assert.equal(member.author_role, 'member')
      assert.equal(member.content, '成员正文')
      assert.equal('content' in rows[0], false)
      for (const key of ['user_id', 'email', 'version', 'deleted_at', 'raw_user_meta_data'])
        assert.equal(key in member, false)
      assert.equal(JSON.stringify(rows).includes('@example.invalid'), false)
      assert.equal(JSON.stringify(rows).includes(CID), false)
      assert.deepEqual((await db.query('select * from public_record_tags()')).rows, [{ tag: '共享标签' }])
      assert.deepEqual((await db.query('select name from storage.objects')).rows, [{ name: cover }])
      for (const table of ['records', 'note_profiles', 'note_members'])
        await assert.rejects(db.query(`select * from ${table}`), /permission denied/)
      await assert.rejects(visible(BID, 2, false), /permission denied/)
      await assert.rejects(nickname('匿名'), /permission denied/)
      await assert.rejects(rpc('note_profile()'), /permission denied/)
      await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['record-covers', `${B}/evil.png`]), /permission denied|row-level security/)
    })
    await t.test('removed membership hides public data and covers and prevents further publication', async () => {
      await db.exec(`reset role; update auth.users set email_confirmed_at=null where id='${B}';`)
      await login('', 'anon')
      assert.deepEqual(await detail(BID), [])
      assert.equal((await list()).length, 1)
      assert.equal((await db.query('select * from storage.objects')).rows.length, 0)
      await login(B)
      await assert.rejects(visible(BID, 2, false), /验证邮箱并兑换邀请码/)
      await db.exec(`reset role; update auth.users set email_confirmed_at=now() where id='${B}';`)
      await login('', 'anon')
      assert.equal((await detail(BID)).length, 1)
      await db.exec(`reset role; delete from note_members where user_id='${B}';`)
      await login('', 'anon')
      assert.deepEqual(await detail(BID), [])
      assert.deepEqual((await db.query('select * from public_record_tags()')).rows, [])
      await db.exec(`reset role; insert into note_members(user_id,invitation_id)
        select '${B}',id from note_invitations where redeemed_by='${B}';`)
    })
    await t.test('unpublishing and trashing revoke public reads and cover access; restore stays private', async () => {
      await login(B)
      await visible(BID, 2, false)
      await login('', 'anon')
      assert.deepEqual(await detail(BID), [])
      assert.equal((await db.query('select * from storage.objects')).rows.length, 0)
      await login(B)
      await visible(BID, 3, true)
      assert.equal((await mutate('trash', 4)).record.is_public, false)
      await assert.rejects(visible(BID, 5, true), /回收站/)
      await login('', 'anon')
      assert.deepEqual(await detail(BID), [])
      assert.equal((await db.query('select * from storage.objects')).rows.length, 0)
      await login(B)
      assert.equal((await mutate('restore', 5)).record.is_public, false)
      await visible(BID, 6, true)
    })
    await t.test('rerunning the upgrade keeps membership, nicknames, publication and scoped pagination', async () => {
      await db.exec('reset role')
      await db.exec(migrations[3])
      await login(B)
      assert.equal((await rpc('note_profile()')).display_name, '小明的练习')
      await login('', 'anon')
      assert.equal((await list()).length, 2)
      assert.equal((await detail(BID))[0].author_role, 'member')
      assert.equal((await db.query('select * from public_records($1,$2)', ['', '共享标签'])).rows.length, 1)
      assert.equal((await db.query('select * from public_records($1)', ['受邀用户'])).rows.length, 1)
      const first = (await db.query('select * from public_records($1,$2,$3,$4,$5)', ['', '', null, null, 1])).rows[0]
      const next = (await db.query('select * from public_records($1,$2,$3,$4,$5)', ['', '', first.created_at, first.id, 1])).rows[0]
      assert.notEqual(first.id, next.id)
    })
  } finally {
    await db.close()
  }
})
