import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { FORTUNES } from '../src/lib/dailyFortune.js'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ID = '11111111-1111-4111-8111-111111111111'
const migrations = await Promise.all([
  '20261015_records_workflow.sql', '20261016_public_showcase.sql',
  '20261017_invitation_auth.sql', '20261018_member_publication.sql',
  '20261019_learning_garden.sql',
  '20261020_remove_learning_garden.sql',
].map((name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')))

test('daily fortune pool preserves the twelve stored draw indexes', () => {
  assert.deepEqual(FORTUNES.map((f) => f.title), [
    '破土', '向阳', '生根', '新芽', '晴日', '微风',
    '花信', '雨后', '留白', '枝叶', '结伴', '常青',
  ])
  assert.deepEqual(new Set(FORTUNES.map((f) => f.luck)), new Set(['大吉', '中吉', '小吉', '平', '末吉', '凶', '大凶']))
  for (const fortune of FORTUNES) {
    assert.ok(fortune.outlook.trim().length > 0)
  }
})

test('garden counts, first publications and daily draws enforce real database boundaries', async (t) => {
  const db = new PGlite()
  const login = (id = A, role = 'authenticated') => db.exec(
    `reset role; select set_config('request.jwt.claim.sub','${id}',false); set role ${role};`,
  )
  const rpc = async (sql, args = []) => (await db.query(`select ${sql} as result`, args)).rows[0].result
  const progress = () => rpc('note_garden_progress()')
  const draw = () => rpc('draw_daily_note_fortune()')
  const publish = (id, version, value = true, request = crypto.randomUUID()) =>
    rpc('set_record_visibility($1,$2,$3,$4)', [request, id, version, value])
  const create = (title = '新练习', tags = ['React', 'React']) => rpc('mutate_record($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), 'create', crypto.randomUUID(), null, title, tags])
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
      insert into auth.users values('${A}','owner@example.invalid',now(),'{}'),
        ('${B}','member@example.invalid',now(),'{}'),('${C}','unverified@example.invalid',null,'{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth,storage to anon,authenticated;
      create table storage.buckets(id text primary key,public boolean default false);
      insert into storage.buckets values('record-covers',false);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
      create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
      alter table storage.objects enable row level security;
      grant select,insert,update,delete on storage.objects to authenticated;
      create table records(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),title text not null,tags text[] not null default '{}',content text not null default '',cover_path text,created_at timestamptz not null default now());
      insert into records(id,user_id,title) values('${ID}','${A}','旧练习');
    `)
    for (const sql of migrations.slice(0, 4)) await db.exec(sql)
    // Real publication receipts on either side of UTC+8 midnight. One note was
    // republished later; historical recovery must still count its first day only.
    await login()
    await publish(ID, 1)
    await publish(ID, 2, false)
    await publish(ID, 3)
    const second = (await create('第二篇', ['C++ & React/#'])).record
    await publish(second.id, 1)
    await db.exec(`reset role;
      update record_mutations set created_at='2026-01-01T15:59:59Z'
        where payload->>'id'='${ID}' and payload->>'version'='1';
      update record_mutations set created_at='2026-01-03T00:00:00Z'
        where payload->>'id'='${ID}' and payload->>'version'='3';
      update record_mutations set created_at='2026-01-01T16:00:00Z'
        where payload->>'id'='${second.id}' and payload->>'action'='publish';
    `)
    await db.exec(migrations[4])
    await t.test('backfill uses first real publish time and UTC+8 date, and rerunning does not duplicate', async () => {
      await db.exec(migrations[4])
      await login()
      assert.equal((await progress()).publish_days, 2)
      assert.equal((await progress()).published_today, false)
      const privateNote = (await create('私密内容', ['不能泄露'])).record
      assert.equal((await progress()).publish_days, 2)
      assert.equal((await rpc('public_learning_garden()')).total, 2)
      assert.ok(!(await rpc('public_learning_garden()')).plants.some((p) => p.tag === '不能泄露'))
      await publish(privateNote.id, 1)
      assert.equal((await progress()).publish_days, 3)
      assert.equal((await progress()).published_today, true)
      const another = (await create()).record
      const request = crypto.randomUUID()
      await publish(another.id, 1, true, request)
      await publish(another.id, 1, true, request)
      assert.equal((await progress()).publish_days, 3)
      assert.equal((await rpc('public_learning_garden()')).plants.find((p) => p.tag === 'React').count, 1)
    })
    await t.test('republishing, editing, trashing and purging old notes do not add or erase days', async () => {
      await publish(ID, 4, false)
      await publish(ID, 5)
      await rpc('mutate_record($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), 'update', ID, 6, '修改旧笔记', ['旧笔记']])
      await rpc('mutate_record($1,$2,$3,$4)', [crypto.randomUUID(), 'trash', ID, 7])
      assert.equal((await rpc('public_learning_garden()')).total, 3)
      await rpc('mutate_record($1,$2,$3,$4)', [crypto.randomUUID(), 'purge', ID, 8])
      assert.equal((await progress()).publish_days, 3)
      await db.exec('reset role')
      await db.exec(migrations[4])
      await login()
      assert.equal((await progress()).publish_days, 3)
    })
    await t.test('confirmed readers can check in without an invitation; same-day retries return one draw', async () => {
      await login(B)
      const first = await draw()
      assert.equal(first.scope, 'self')
      assert.equal(first.publish_days, 0)
      assert.equal(first.checkin_days, 1)
      assert.ok(first.fortune_index >= 0 && first.fortune_index < FORTUNES.length)
      assert.deepEqual(await draw(), first)
      assert.deepEqual(await progress(), first)
      await login()
      const owner = await draw()
      assert.equal(owner.publish_days, 3)
      assert.equal(owner.checkin_days, 1)
      await login(B)
      assert.deepEqual(await progress(), first)
      // Simulate an older check-in; today's persisted result remains untouched.
      await db.exec(`reset role; insert into note_daily_checkins(user_id,day,fortune_index)
        values('${B}',(statement_timestamp() at time zone 'Asia/Taipei')::date-1,0);`)
      await login(B)
      assert.equal((await draw()).checkin_days, 2)
      assert.equal((await draw()).fortune_index, first.fortune_index)
    })
    await t.test('unverified users and anonymous clients cannot draw or tamper with history', async () => {
      await login(C)
      assert.equal((await progress()).can_check_in, false)
      await assert.rejects(draw(), /验证邮箱/)
      await login(B)
      for (const table of ['note_daily_checkins', 'note_first_publications']) {
        await assert.rejects(db.query(`select * from ${table}`), /permission denied/)
        await assert.rejects(db.query(`delete from ${table}`), /permission denied/)
      }
      await login('', 'anon')
      const visitor = await progress()
      assert.equal(visitor.scope, 'owner')
      assert.equal(visitor.publish_days, 3)
      assert.equal(visitor.fortune_index, null)
      assert.equal(visitor.checkin_days, 0)
      assert.equal(visitor.can_check_in, false)
      assert.equal('user_id' in visitor, false)
      await assert.rejects(draw(), /permission denied/)
      await assert.rejects(rpc('track_first_note_publication()'), /permission denied/)
    })
    await t.test('garden excludes revoked membership and private notes while preserving aggregate growth', async () => {
      await login()
      const code = '0123456789ABCDEF0123456789ABCDEF'
      await rpc('issue_note_invitation($1,$2,7)', [crypto.randomUUID(), code])
      await login(B)
      await rpc('redeem_note_invitation($1)', [code])
      const note = (await create('受邀公开', ['成员植物'])).record
      await publish(note.id, 1)
      assert.equal((await progress()).publish_days, 1)
      await login('', 'anon')
      assert.ok((await rpc('public_learning_garden()')).plants.some((p) => p.tag === '成员植物'))
      await db.exec(`reset role; delete from note_members where user_id='${B}';`)
      await login('', 'anon')
      assert.ok(!(await rpc('public_learning_garden()')).plants.some((p) => p.tag === '成员植物'))
      await login(B)
      assert.equal((await progress()).publish_days, 1)
      assert.equal((await draw()).checkin_days, 2)
    })
    await t.test('removing the garden endpoint preserves publications and daily draws and is repeatable', async () => {
      const before = await progress()
      await db.exec('reset role')
      await db.exec(migrations[5])
      await db.exec(migrations[5])
      await login(B)
      await assert.rejects(rpc('public_learning_garden()'), /does not exist/)
      assert.deepEqual(await progress(), before)
      assert.deepEqual(await draw(), before)
      await login('', 'anon')
      assert.equal((await progress()).publish_days, 3)
    })
  } finally { await db.close() }
})
