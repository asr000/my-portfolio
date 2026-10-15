import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ID = '11111111-1111-4111-8111-111111111111'
const BID = '22222222-2222-4222-8222-222222222222'
const cover = `${A}/cover.png`
const privateCover = `${A}/private.png`
const migration = await readFile(
  new URL(
    '../supabase/migrations/20261016_public_showcase.sql',
    import.meta.url,
  ),
  'utf8',
)

async function prepare() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text);
    insert into auth.users values('${A}','author@example.invalid'),('${B}','reader@example.invalid');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth, storage to anon, authenticated;
    create table storage.buckets(id text primary key, public boolean not null default false);
    insert into storage.buckets values('record-covers', false);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
    alter table storage.objects enable row level security;
    grant select, insert, delete on storage.objects to authenticated;
    create policy own_files_read on storage.objects for select to authenticated using ((storage.foldername(name))[1]=auth.uid()::text);
    create policy own_files_upload on storage.objects for insert to authenticated with check ((storage.foldername(name))[1]=auth.uid()::text);
    create table public.records(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id), title text not null,tags text[] not null default '{}',content text not null default '',cover_path text,created_at timestamptz not null default now());
    insert into records(id,user_id,title,tags,content,cover_path,created_at) values('${ID}','${A}','公开练习100%_','{React}','## 练习正文','${cover}','2026-10-15');
    insert into storage.objects(bucket_id,name) values('record-covers','${cover}'),('record-covers','${privateCover}');
  `)
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261015_records_workflow.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  return db
}

async function login(db, id = A, role = 'authenticated') {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub','${id}',false); set role ${role};`,
  )
}
async function visibility(
  db,
  visible,
  version,
  request = crypto.randomUUID(),
  id = ID,
) {
  return (
    await db.query('select set_record_visibility($1,$2,$3,$4) as result', [
      request,
      id,
      version,
      visible,
    ])
  ).rows[0].result
}
async function mutate(db, action, version) {
  return (
    await db.query('select mutate_record($1,$2,$3,$4) as result', [
      crypto.randomUUID(),
      action,
      ID,
      version,
    ])
  ).rows[0].result
}
async function publicDetail(db, id = ID) {
  return (await db.query('select * from public_record($1)', [id])).rows
}

test('selective publication keeps private records, author control and covers isolated', async (t) => {
  const db = await prepare()
  try {
    await db.exec(migration)
    await db.exec(migration)
    await t.test(
      'migration binds the one existing author and publishes nothing',
      async () => {
        await login(db)
        assert.equal(
          (await db.query('select is_portfolio_author() as yes')).rows[0].yes,
          true,
        )
        assert.equal(
          (await db.query('select is_public from records')).rows[0].is_public,
          false,
        )
        await assert.rejects(
          db.query('select * from portfolio_site'),
          /permission denied/,
        )
        await login(db, '', 'anon')
        assert.deepEqual(await publicDetail(db), [])
        assert.deepEqual(
          (await db.query('select * from public_records()')).rows,
          [],
        )
        assert.deepEqual(
          (await db.query('select * from public_record_tags()')).rows,
          [],
        )
        assert.equal(
          (await db.query('select * from storage.objects')).rows.length,
          0,
        )
        await assert.rejects(
          db.query('select * from records'),
          /permission denied/,
        )
        await assert.rejects(visibility(db, true, 1), /permission denied/)
      },
    )
    await t.test(
      'publication is version checked and a repeated request does not publish twice',
      async () => {
        await login(db)
        const request = crypto.randomUUID()
        const first = await visibility(db, true, 1, request)
        assert.equal(first.record.is_public, true)
        assert.equal(first.record.version, 2)
        assert.deepEqual(await visibility(db, true, 1, request), first)
        await assert.rejects(visibility(db, false, 2, request), /操作编号/)
        await assert.rejects(visibility(db, false, 1), /其他页面或设备修改/)
      },
    )
    await t.test(
      'guests get published fields and the published cover, without private table access',
      async () => {
        await login(db, '', 'anon')
        const detail = (await publicDetail(db))[0]
        assert.equal(detail.content, '## 练习正文')
        assert.equal('user_id' in detail, false)
        assert.equal('version' in detail, false)
        assert.equal('deleted_at' in detail, false)
        const list = (await db.query('select * from public_records()')).rows
        assert.equal(list.length, 1)
        assert.equal('content' in list[0], false)
        assert.deepEqual(
          (await db.query('select * from public_record_tags()')).rows,
          [{ tag: 'React' }],
        )
        assert.deepEqual(
          (await db.query('select name from storage.objects')).rows,
          [{ name: cover }],
        )
        await assert.rejects(
          db.query('select * from records'),
          /permission denied/,
        )
        await assert.rejects(
          db.query('select * from record_mutations'),
          /permission denied/,
        )
        await assert.rejects(
          db.query('select * from record_tags(false)'),
          /permission denied/,
        )
      },
    )
    await t.test(
      'even broad legacy storage policies cannot grant guest writes or private-file reads',
      async () => {
        await db.exec(
          'reset role; grant all on storage.objects to anon, authenticated; create policy legacy_wide on storage.objects for all to anon,authenticated using(true) with check(true);',
        )
        await login(db, '', 'anon')
        assert.deepEqual(
          (await db.query('select name from storage.objects')).rows,
          [{ name: cover }],
        )
        assert.equal(
          (await db.query('delete from storage.objects returning name')).rows
            .length,
          0,
        )
        assert.equal(
          (
            await db.query(
              "update storage.objects set name='changed' returning name",
            )
          ).rows.length,
          0,
        )
        await assert.rejects(
          db.query(
            'insert into storage.objects(bucket_id,name) values($1,$2)',
            ['record-covers', `${A}/evil.png`],
          ),
          /row-level security/,
        )
        await login(db)
        assert.equal(
          (
            await db.query(
              'delete from storage.objects where name=$1 returning name',
              [cover],
            )
          ).rows.length,
          0,
        )
      },
    )
    await t.test(
      'another signed-in user can read public work but cannot publish or manage the author',
      async () => {
        await login(db, B)
        assert.equal(
          (await db.query('select is_portfolio_author() as yes')).rows[0].yes,
          false,
        )
        assert.equal((await publicDetail(db)).length, 1)
        assert.equal((await db.query('select * from records')).rows.length, 0)
        assert.deepEqual(
          (await db.query('select name from storage.objects')).rows,
          [{ name: cover }],
        )
        await assert.rejects(visibility(db, false, 2), /只有网站作者/)
        await db.query('select mutate_record($1,$2,$3,$4,$5)', [
          crypto.randomUUID(),
          'create',
          BID,
          null,
          '其他账号私密记录',
        ])
        await assert.rejects(
          visibility(db, true, 1, crypto.randomUUID(), BID),
          /只有网站作者/,
        )
        await db.exec('reset role')
        await assert.rejects(
          db.query('update records set is_public=true where id=$1', [BID]),
          /只有网站作者/,
        )
        await login(db, '', 'anon')
        assert.deepEqual(await publicDetail(db, BID), [])
      },
    )
    await t.test(
      'withdrawing publication removes both new record reads and cover access',
      async () => {
        await login(db)
        const result = await visibility(db, false, 2)
        assert.equal(result.record.version, 3)
        await login(db, '', 'anon')
        assert.deepEqual(await publicDetail(db), [])
        assert.equal(
          (await db.query('select name from storage.objects')).rows.length,
          0,
        )
      },
    )
    await t.test(
      'trashing unpublishes and restoring keeps the record private',
      async () => {
        await login(db)
        await visibility(db, true, 3)
        const trashed = await mutate(db, 'trash', 4)
        assert.equal(trashed.record.is_public, false)
        await assert.rejects(visibility(db, true, 5), /回收站/)
        await login(db, '', 'anon')
        assert.deepEqual(await publicDetail(db), [])
        assert.equal(
          (await db.query('select * from storage.objects')).rows.length,
          0,
        )
        await login(db)
        const restored = await mutate(db, 'restore', 5)
        assert.equal(restored.record.is_public, false)
        assert.equal(restored.record.version, 6)
        await visibility(db, true, 6)
        await db.exec('reset role')
        await db.exec(migration)
        await login(db, '', 'anon')
        assert.equal((await publicDetail(db)).length, 1)
      },
    )
    await t.test(
      'public search treats wildcards literally, limits pages and handles tied timestamps',
      async () => {
        assert.equal(
          (await db.query('select * from public_records($1)', ['100%_'])).rows
            .length,
          1,
        )
        assert.equal(
          (await db.query('select * from public_records($1)', ['missing%']))
            .rows.length,
          0,
        )
        await db.exec(
          `reset role; insert into records(user_id,title,is_public,created_at) select '${A}','分页' || g,true,'2027-01-01' from generate_series(1,60)g;`,
        )
        await login(db, '', 'anon')
        const first = (
          await db.query('select * from public_records($1,$2,$3,$4,$5)', [
            '分页',
            '',
            null,
            null,
            1,
          ])
        ).rows[0]
        const second = (
          await db.query('select * from public_records($1,$2,$3,$4,$5)', [
            '分页',
            '',
            first.created_at,
            first.id,
            1,
          ])
        ).rows[0]
        assert.ok(second.id < first.id)
        assert.equal(
          (
            await db.query('select * from public_records($1,$2,$3,$4,$5)', [
              '',
              '',
              null,
              null,
              100000,
            ])
          ).rows.length,
          50,
        )
      },
    )
  } finally {
    await db.close()
  }
})

test('ambiguous author and public bucket fail closed without publishing existing data', async () => {
  const db = await prepare()
  try {
    await db.exec(
      `insert into records(user_id,title) values('${B}','第二个作者');`,
    )
    await assert.rejects(db.exec(migration), /无法唯一确定网站作者/)
    await db.exec('rollback;')
    await db.exec(
      `delete from records where user_id='${B}'; update storage.buckets set public=true;`,
    )
    await assert.rejects(db.exec(migration), /当前为 Public/)
    await db.exec('rollback;')
  } finally {
    await db.close()
  }
})
