import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('migration, account isolation, idempotency, conflict and recycle-bin lifecycle', async (t) => {
  const db = new PGlite()
  const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const id = '11111111-1111-4111-8111-111111111111'
  const cover = `${a}/cover.webp`
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      insert into auth.users values('${a}'),('${b}');
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema public, auth, storage to anon, authenticated;
      create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql immutable as $$
        select (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'),1)-1]
      $$;
      alter table storage.objects enable row level security;
      grant select, insert, delete on storage.objects to authenticated;
      create policy own_files_read on storage.objects for select to authenticated using ((storage.foldername(name))[1] = auth.uid()::text);
      create policy own_files_upload on storage.objects for insert to authenticated with check ((storage.foldername(name))[1] = auth.uid()::text);
      create table public.records(
        id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
        title text not null, tags text[] not null default '{}', content text not null default '',
        cover_path text, created_at timestamptz not null default now()
      );
    `)
    const migration = await readFile(
      new URL(
        '../supabase/migrations/20261015_records_workflow.sql',
        import.meta.url,
      ),
      'utf8',
    )
    await db.exec(migration)
    await db.exec(migration)
    async function login(user = a, role = 'authenticated') {
      await db.exec(
        `reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role ${role};`,
      )
    }
    const createRequest = '22222222-2222-4222-8222-222222222222'
    async function mutate(
      action,
      version,
      request = crypto.randomUUID(),
      changes = {},
    ) {
      const params = [
        request,
        action,
        id,
        version,
        changes.title ?? '第一条记录',
        changes.tags ?? ['React'],
        changes.content ?? '正文',
        changes.cover ?? null,
      ]
      const result = await db.query(
        'select public.mutate_record($1,$2,$3,$4,$5,$6,$7,$8) as result',
        params,
      )
      return result.rows[0].result
    }
    await login()
    await t.test('create and repeated request inserts once', async () => {
      await db.query(
        'insert into storage.objects(bucket_id,name) values ($1,$2)',
        ['record-covers', cover],
      )
      const first = await mutate('create', null, createRequest, { cover })
      const repeat = await mutate('create', null, createRequest, { cover })
      assert.equal(first.record.id, id)
      assert.deepEqual(first, repeat)
      assert.equal((await db.query('select * from records')).rows.length, 1)
    })
    await t.test(
      'same request id cannot be reused for changed payload',
      async () => {
        await assert.rejects(
          mutate('create', null, createRequest, { title: '其他标题', cover }),
          /操作编号/,
        )
      },
    )
    await t.test(
      'cross-account read, write and forged cover are rejected',
      async () => {
        await login(b)
        assert.equal((await db.query('select * from records')).rows.length, 0)
        await assert.rejects(mutate('update', 1), /访问权限/)
        await assert.rejects(
          mutate('create', null, crypto.randomUUID(), { cover }),
          /封面不属于/,
        )
        await login()
      },
    )
    await t.test('direct writes and receipt reads are denied', async () => {
      await assert.rejects(
        db.query("update records set title='绕过接口'"),
        /permission denied/,
      )
      await assert.rejects(
        db.query('select * from record_mutations'),
        /permission denied/,
      )
    })
    await t.test('blank title and too many tags are rejected', async () => {
      await assert.rejects(
        mutate('update', 1, crypto.randomUUID(), { title: '   ' }),
        /标题/,
      )
      await assert.rejects(
        mutate('update', 1, crypto.randomUUID(), {
          tags: Array(13).fill('tag'),
        }),
        /标签/,
      )
    })
    await t.test(
      'update preserves record id, increments version and detects stale edits',
      async () => {
        const updated = await mutate('update', 1, crypto.randomUUID(), {
          title: '已修改',
          cover,
        })
        assert.equal(updated.record.id, id)
        assert.equal(updated.record.version, 2)
        await assert.rejects(mutate('update', 1), /其他页面或设备修改/)
      },
    )
    await t.test('referenced cover cannot be deleted', async () => {
      assert.equal(
        (
          await db.query(
            'delete from storage.objects where name=$1 returning name',
            [cover],
          )
        ).rows.length,
        0,
      )
    })
    await t.test('storage ownership holds even if an older permissive policy exists', async () => {
      await db.exec('reset role; create policy legacy_wide_storage on storage.objects for all to authenticated using (true) with check (true);')
      await login(b)
      assert.equal((await db.query('select * from storage.objects')).rows.length, 0)
      assert.equal((await db.query('delete from storage.objects returning name')).rows.length, 0)
      await login()
      assert.equal((await db.query('delete from storage.objects where name=$1 returning name', [cover])).rows.length, 0)
    })
    await t.test('tag search is account-scoped', async () => {
      assert.deepEqual(
        (await db.query('select * from record_tags(false)')).rows,
        [{ tag: 'React' }],
      )
      await login(b)
      assert.deepEqual(
        (await db.query('select * from record_tags(false)')).rows,
        [],
      )
      await login()
    })
    await t.test(
      'trash retains data and cover; repeat is idempotent',
      async () => {
        const request = crypto.randomUUID()
        const result = await mutate('trash', 2, request)
        assert.ok(result.record.deleted_at)
        assert.deepEqual(await mutate('trash', 2, request), result)
        assert.equal(
          (await db.query('select * from records where deleted_at is null'))
            .rows.length,
          0,
        )
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
      'restore and purge require correct state and version',
      async () => {
        const restored = await mutate('restore', 3)
        assert.equal(restored.record.deleted_at, null)
        assert.equal(restored.record.version, 4)
        await assert.rejects(mutate('purge', 4), /先移入回收站/)
        await mutate('trash', 4)
        const result = await mutate('purge', 5)
        assert.equal(result.old_cover_path, cover)
        assert.equal((await db.query('select * from records')).rows.length, 0)
        assert.equal(
          (
            await db.query(
              'delete from storage.objects where name=$1 returning name',
              [cover],
            )
          ).rows.length,
          1,
        )
      },
    )
    await t.test('anonymous cannot call mutation RPC', async () => {
      await login('', 'anon')
      await assert.rejects(mutate('create', null), /permission denied/)
    })
  } finally {
    await db.close()
  }
})
