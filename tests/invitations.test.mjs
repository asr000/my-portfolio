import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const ID = '11111111-1111-4111-8111-111111111111'
const code = '0123456789ABCDEF0123456789ABCDEF'
const migrations = await Promise.all(
  [
    '20261015_records_workflow.sql',
    '20261016_public_showcase.sql',
    '20261017_invitation_auth.sql',
  ].map((name) =>
    readFile(
      new URL(`../supabase/migrations/${name}`, import.meta.url),
      'utf8',
    ),
  ),
)

test('invitation membership gates real database writes independently of the website', async (t) => {
  const db = new PGlite()
  const issued = crypto.randomUUID()
  const spare = crypto.randomUUID()
  const spareCode = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
  const login = async (user = A, role = 'authenticated') =>
    db.exec(
      `reset role; select set_config('request.jwt.claim.sub','${user}',false); set role ${role};`,
    )
  const rpc = async (sql, params = []) =>
    (await db.query(`select ${sql} as result`, params)).rows[0].result
  const issue = (id, token, days = 7) =>
    rpc('issue_note_invitation($1,$2,$3)', [id, token, days])
  const redeem = (token) => rpc('redeem_note_invitation($1)', [token])
  const mutate = (action, userId = ID, version = null) =>
    rpc('mutate_record($1,$2,$3,$4,$5)', [
      crypto.randomUUID(),
      action,
      userId,
      version,
      '笔记',
    ])
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
      insert into auth.users values('${A}','author@example.invalid',now(),'{}'),('${B}','b@example.invalid',now(),'{"can_write":true,"is_author":true}'),('${C}','c@example.invalid',now(),'{}'),('${D}','d@example.invalid',null,'{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth,storage to anon,authenticated;
      create table storage.buckets(id text primary key,public boolean default false);
      insert into storage.buckets values('record-covers',false);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
      create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
      alter table storage.objects enable row level security;
      grant select,insert,update,delete on storage.objects to authenticated;
      create policy legacy_allow_all on storage.objects for all to authenticated using(true) with check(true);
      create table records(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),title text not null,tags text[] not null default '{}',content text not null default '',cover_path text,created_at timestamptz not null default now());
      insert into records(id,user_id,title) values('${ID}','${A}','作者笔记');
    `)
    for (const migration of migrations) await db.exec(migration)
    await db.exec(migrations[2])
    await t.test(
      'author keeps access while registration and forged metadata grant no membership',
      async () => {
        await login()
        assert.equal((await rpc('note_access()')).can_write, true)
        await login(B)
        assert.deepEqual(await rpc('note_access()'), {
          is_author: false,
          can_write: false,
          email_verified: true,
        })
        await assert.rejects(
          mutate('create', crypto.randomUUID()),
          /兑换邀请码/,
        )
        await assert.rejects(
          db.query(
            `insert into storage.objects(bucket_id,name) values('record-covers','${B}/b.png')`,
          ),
          /row-level security/,
        )
        for (const table of [
          'note_members',
          'note_invitations',
          'note_invitation_attempts',
        ])
          await assert.rejects(
            db.query(`select * from ${table}`),
            /permission denied/,
          )
        await assert.rejects(
          db.query(
            `insert into note_members(user_id,invitation_id) values('${B}','${issued}')`,
          ),
          /permission denied/,
        )
      },
    )
    await t.test(
      'only the author issues and revokes; retries retain one invitation and no plaintext code',
      async () => {
        await login(B)
        await assert.rejects(issue(issued, code), /只有网站作者/)
        await assert.rejects(
          rpc('revoke_note_invitation($1)', [issued]),
          /只有网站作者/,
        )
        await assert.rejects(
          db.query('select * from list_note_invitations()'),
          /只有网站作者/,
        )
        await login()
        const first = await issue(issued, code)
        assert.deepEqual(await issue(issued, code), first)
        await assert.rejects(issue(issued, code, 30), /操作编号/)
        await issue(spare, spareCode, 30)
        const list = (await db.query('select * from list_note_invitations()'))
          .rows
        assert.equal(list.length, 2)
        assert.equal(JSON.stringify(list).includes(code), false)
        await db.exec('reset role')
        const saved = (
          await db.query('select * from note_invitations where id=$1', [issued])
        ).rows[0]
        assert.equal(saved.code_hash.length, 64)
        assert.equal(JSON.stringify(saved).includes(code), false)
      },
    )
    await t.test(
      'email confirmation is required, and an unconfirmed user never consumes the code',
      async () => {
        await login(D)
        await assert.rejects(redeem(code), /先验证邮箱/)
        assert.equal((await rpc('note_access()')).email_verified, false)
        await db.exec('reset role')
        assert.equal(
          (
            await db.query(
              'select redeemed_at from note_invitations where id=$1',
              [issued],
            )
          ).rows[0].redeemed_at,
          null,
        )
      },
    )
    await t.test(
      'one code activates one account, repeated redemption never consumes a second code',
      async () => {
        await login(B)
        assert.equal(
          (await redeem('01234567-89abcdef-01234567-89abcdef')).ok,
          true,
        )
        assert.equal((await rpc('note_access()')).can_write, true)
        assert.equal((await redeem(code)).already_active, true)
        assert.equal((await redeem(spareCode)).already_active, true)
        await login(C)
        assert.equal((await redeem(code)).ok, false)
        await login()
        await assert.rejects(
          rpc('revoke_note_invitation($1)', [issued]),
          /已兑换/,
        )
        await db.exec('reset role')
        assert.equal(
          (
            await db.query(
              'select redeemed_at from note_invitations where id=$1',
              [spare],
            )
          ).rows[0].redeemed_at,
          null,
        )
      },
    )
    await t.test(
      'member writes and covers work while other accounts and author publication stay isolated',
      async () => {
        const memberId = crypto.randomUUID()
        await login(B)
        const created = await mutate('create', memberId)
        assert.equal(created.record.user_id, B)
        assert.equal(created.record.is_public, false)
        await db.query(
          `insert into storage.objects(bucket_id,name) values('record-covers','${B}/b.png')`,
        )
        await assert.rejects(
          db.query(
            `insert into storage.objects(bucket_id,name) values('record-covers','${A}/forged.png')`,
          ),
          /row-level security/,
        )
        await assert.rejects(
          rpc('set_record_visibility($1,$2,$3,true)', [
            crypto.randomUUID(),
            memberId,
            1,
          ]),
          /只有网站作者/,
        )
        await assert.rejects(mutate('update', ID, 1), /没有访问权限/)
        await mutate('update', memberId, 1)
        await mutate('trash', memberId, 2)
        await mutate('restore', memberId, 3)
        await mutate('trash', memberId, 4)
        await mutate('purge', memberId, 5)
        assert.equal((await db.query('select * from records')).rows.length, 0)
        await login(C)
        assert.equal((await db.query('select * from records')).rows.length, 0)
      },
    )
    await t.test(
      'revoked and expired codes fail; failed attempts persist and rate limits block guessing',
      async () => {
        await login()
        await rpc('revoke_note_invitation($1)', [spare])
        await rpc('revoke_note_invitation($1)', [spare])
        const expired = crypto.randomUUID()
        const expiredCode = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
        const valid = crypto.randomUUID()
        const validCode = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
        await issue(expired, expiredCode)
        await issue(valid, validCode)
        await db.exec(
          `reset role; update note_invitations set expires_at=now()-interval '1 second' where id='${expired}'`,
        )
        await login(C)
        assert.equal((await redeem(spareCode)).ok, false)
        assert.equal((await redeem(expiredCode)).ok, false)
        await redeem('bad')
        await redeem('bad')
        const limited = await redeem(validCode)
        assert.equal(limited.ok, false)
        assert.match(limited.message, /15 分钟/)
        await db.exec(
          `reset role; update note_invitation_attempts set window_started_at=now()-interval '16 minutes' where user_id='${C}'`,
        )
        await login(C)
        assert.equal((await redeem(validCode)).ok, true)
      },
    )
    await t.test(
      'upgrade rerun preserves membership and public readers, anonymous calls cannot mutate',
      async () => {
        await db.exec('reset role')
        await db.exec(migrations[2])
        await login(B)
        assert.equal((await rpc('note_access()')).can_write, true)
        await login()
        await rpc('set_record_visibility($1,$2,$3,true)', [
          crypto.randomUUID(),
          ID,
          1,
        ])
        await login('', 'anon')
        assert.equal(
          (await db.query('select * from public_records()')).rows.length,
          1,
        )
        for (const fn of [
          'note_access()',
          'can_write_notes()',
          'redeem_note_invitation($1)',
        ])
          await assert.rejects(
            rpc(fn, fn.includes('$1') ? [code] : []),
            /permission denied/,
          )
        await assert.rejects(
          mutate('create', crypto.randomUUID()),
          /permission denied/,
        )
      },
    )
  } finally {
    await db.close()
  }
})
