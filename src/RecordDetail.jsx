import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  cleanupFiles,
  currentUser,
  getRecord,
  mutateRecord,
  queueCleanup,
} from './lib/recordsApi.js'
import { readLocal, removeLocal, writeLocal } from './lib/localData.js'
import { errorText, formatDate } from './lib/recordUtils.js'
import { useCover } from './lib/useCover.js'
import ConfirmDialog from './ConfirmDialog.jsx'
import { listReturn, loginLink, recordLink } from './lib/navigation.js'
import { supabase } from './lib/supabaseClient.js'
import PublicRecord from './PublicRecord.jsx'

const MarkdownContent = lazy(() => import('./MarkdownContent.jsx'))

export default function RecordDetail({ recordId, manage = false }) {
  const [record, setRecord] = useState(null)
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [dialog, setDialog] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [pending, setPending] = useState(null)
  const [canPublish, setCanPublish] = useState(null)
  const [publicationError, setPublicationError] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const [needsReload, setNeedsReload] = useState(false)
  const locked = useRef(false)
  const cover = useCover(manage ? null : record?.cover_path)
  const params = new URLSearchParams(window.location.search)
  const back = listReturn(
    params.get('back'),
    record?.deleted_at ? 'trash' : 'records',
  )
  const detailHref = recordLink(recordId, { back })
  const manageHref = recordLink(recordId, { back, manage: true })
  const publicHref = recordLink(recordId, {
    publicView: true,
    back: '/?view=showcase',
  })
  const publicUrl = new URL(publicHref, window.location.origin).href
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const account = await currentUser()
        if (!active) return
        if (!account) {
          setStatus('signed-out')
          return
        }
        setUser(account)
        const operation = readLocal(`action:${account.id}:${recordId}`)
        if (operation) setPending(operation)
        const data = await getRecord(recordId)
        if (active) {
          setRecord(data)
          setStatus(data ? 'ready' : manage ? 'not-found' : 'public')
        }
        if (manage && data) {
          const { data: allowed, error } = await supabase
            .rpc('can_write_notes')
            .retry(false)
          if (active) {
            setCanPublish(!error && !!allowed)
            setPublicationError(error ? errorText(error) : '')
          }
        }
      } catch (err) {
        if (active) {
          setMessage(errorText(err))
          setStatus('error')
        }
      }
    }
    load()
    return () => {
      active = false
    }
  }, [recordId, reload, manage])
  async function act(action) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setActionMessage('')
    setNeedsReload(false)
    const key = `action:${user.id}:${recordId}`
    const request = pending || {
      requestId: crypto.randomUUID(),
      action,
      recordId,
      version: record.version,
    }
    try {
      const account = await currentUser()
      if (account?.id !== user.id) throw new Error('账号已变化，请重新登录。')
      writeLocal(key, request)
      setPending(request)
      const result = await mutateRecord(request)
      // Store cleanup first, so a refresh after a successful purge can still retry cleanup.
      if (result.old_cover_path) queueCleanup(user.id, result.old_cover_path)
      removeLocal(key)
      setPending(null)
      let notice = ''
      try {
        if (
          !['publish', 'unpublish'].includes(request.action) &&
          (await cleanupFiles(user.id))
        )
          notice =
            '记录操作成功，部分旧图片仍待清理，可前往记录管理中的封面清理重试。'
      } catch {
        notice = '记录操作成功，旧图片清理未完成。'
      }
      if (request.action === 'purge' || request.action === 'trash') {
        const target = request.action === 'purge' ? '/?view=trash' : back
        window.location.assign(
          `${target}${notice ? `&notice=${encodeURIComponent(notice)}` : ''}`,
        )
      } else {
        setRecord(result.record)
        setDialog(null)
        setActionMessage(
          notice ||
            (request.action === 'publish'
              ? '记录已公开，可以复制公开链接分享。'
              : request.action === 'unpublish'
                ? '已取消公开，记录仅自己可见。'
                : '记录已恢复，保持仅自己可见。'),
        )
        setCopyMessage('')
      }
    } catch (err) {
      if (err.code) {
        setPending(null)
        try {
          removeLocal(key)
        } catch {
          /* retain retry receipt */
        }
      }
      setNeedsReload(err.code === '40001')
      setActionMessage(
        err.code === '40001'
          ? '记录已在其他页面或设备修改，请重新读取记录后再操作。'
          : `${errorText(err)}${!err.code ? ' 如结果不确定，请重试原操作。' : ''}`,
      )
      setDialog(null)
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopyMessage('公开链接已复制。')
    } catch {
      setCopyMessage('未能自动复制，请选中下方链接手动复制。')
    }
  }
  const notice = new URLSearchParams(window.location.search).get('notice')
  if (status === 'public') return <PublicRecord recordId={recordId} />
  return (
    <main className="record-page">
      <a className="record-back" href={manage && record ? detailHref : back}>
        ← {manage && record ? '返回记录详情' : '返回记录列表'}
      </a>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {status === 'loading' && <p role="status">正在读取详情…</p>}
      {status === 'signed-out' && (
        <a
          className="record-create-link"
          href={loginLink(window.location.pathname + window.location.search)}
        >
          请先登录
        </a>
      )}
      {status === 'error' && (
        <div role="alert">
          <p>{message}</p>
          <button onClick={() => setReload((n) => n + 1)}>重试读取</button>
        </div>
      )}
      {status === 'not-found' && <p>记录不存在，或当前账号没有访问权限。</p>}
      {pending && (
        <div className="notice">
          <p>上次操作结果尚未确认。</p>
          {manage ? (
            <button disabled={busy} onClick={() => act(pending.action)}>
              重试上次操作
            </button>
          ) : (
            <a className="text-link" href={manageHref}>
              处理上次操作 →
            </a>
          )}
        </div>
      )}
      {actionMessage && (
        <p className="notice" role="status">
          {actionMessage}
          {needsReload && (
            <button
              disabled={busy}
              onClick={() => {
                setActionMessage('')
                setNeedsReload(false)
                setStatus('loading')
                setCanPublish(null)
                setReload((n) => n + 1)
              }}
            >
              重新读取记录
            </button>
          )}
        </p>
      )}
      {record && status === 'ready' && (
        <article className="record-article">
          {record.deleted_at && (
            <p className="notice">这条记录在回收站中，封面仍然保留。</p>
          )}
          <h1>{manage ? '管理记录' : record.title}</h1>
          {manage && <h2 className="managed-record-title">{record.title}</h2>}
          <p className="record-meta">
            创建于 {formatDate(record.created_at)}
            {record.updated_at && ` · 更新于 ${formatDate(record.updated_at)}`}
          </p>
          {manage ? (
            <>
              <p className="helper">
                {record.deleted_at
                  ? '恢复后可继续编辑；彻底删除无法撤销。'
                  : '修改内容或封面，请进入编辑页面。暂时不需要的记录可以移入回收站。'}
              </p>
              <div className="actions record-actions">
                {!record.deleted_at ? (
                  <>
                    <a
                      className="record-create-link"
                      aria-disabled={!!pending || busy}
                      onClick={(e) => {
                        if (pending || busy) e.preventDefault()
                      }}
                      href={recordLink(record.id, { back, edit: true })}
                    >
                      编辑记录
                    </a>
                    <button
                      className="danger-button"
                      disabled={busy || !!pending}
                      onClick={() => setDialog('trash')}
                    >
                      移入回收站
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      disabled={busy || !!pending}
                      onClick={() => act('restore')}
                    >
                      恢复记录
                    </button>
                    <button
                      className="danger-button"
                      disabled={busy || !!pending}
                      onClick={() => setDialog('purge')}
                    >
                      彻底删除
                    </button>
                  </>
                )}
              </div>
              {!record.deleted_at && (
                <section className="publication-settings" aria-label="公开设置">
                  <h2>公开展示</h2>
                  <p className="helper">
                    {record.is_public
                      ? '当前已公开：访客无需登录即可阅读。后续保存的修改也会更新公开内容。'
                      : '当前仅自己可见。公开后，标题、标签、正文、封面和来源昵称会显示在首页与公开列表。'}
                  </p>
                  {publicationError ? (
                    <p role="alert">
                      公开设置暂不可用：{publicationError}{' '}
                      <button onClick={() => setReload((n) => n + 1)}>
                        重试公开设置
                      </button>
                    </p>
                  ) : canPublish === null ? (
                    <p role="status">正在读取公开设置…</p>
                  ) : canPublish ? (
                    <button
                      className={record.is_public ? 'secondary-button' : ''}
                      disabled={busy || !!pending}
                      onClick={() =>
                        setDialog(record.is_public ? 'unpublish' : 'publish')
                      }
                    >
                      {record.is_public ? '取消公开' : '公开展示'}
                    </button>
                  ) : (
                    <p className="helper">
                      请先验证邮箱并兑换邀请码，再公开自己的笔记。
                    </p>
                  )}
                  {record.is_public && (
                    <div className="share-link-field">
                      <a
                        className="text-link"
                        href={publicHref}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        查看公开页面 ↗
                      </a>
                      <label htmlFor="public-record-url">公开链接</label>
                      <input
                        id="public-record-url"
                        readOnly
                        value={publicUrl}
                        onFocus={(event) => event.target.select()}
                      />
                      <button
                        className="secondary-button"
                        disabled={busy || !!pending}
                        onClick={copyLink}
                      >
                        复制公开链接
                      </button>
                      {copyMessage && (
                        <small role="status">{copyMessage}</small>
                      )}
                    </div>
                  )}
                </section>
              )}
            </>
          ) : (
            <>
              {!pending && (
                <div className="record-reading-tools">
                  <a className="text-link" href={manageHref}>
                    管理记录
                    <span className="record-management-hint">
                      {record.deleted_at ? '恢复 / 彻底删除' : '编辑 / 删除'}
                    </span>{' '}
                    →
                  </a>
                </div>
              )}
              <div className="record-tags">
                {record.tags.map((tag) => (
                  <a
                    className="record-tag"
                    key={tag}
                    href={`/?view=search&tag=${encodeURIComponent(tag)}`}
                  >
                    {tag}
                  </a>
                ))}
              </div>
              {cover.loading && <p role="status">正在读取封面…</p>}
              {cover.error && (
                <p role="status">
                  封面加载失败。<button onClick={cover.retry}>重试封面</button>
                </p>
              )}
              {cover.url && !cover.error && (
                <img
                  className="record-cover"
                  src={cover.url}
                  alt={`${record.title}的封面`}
                  onError={cover.fail}
                />
              )}
              <Suspense fallback={<p role="status">正在排版正文…</p>}>
                <MarkdownContent content={record.content} />
              </Suspense>
            </>
          )}
        </article>
      )}
      {dialog && (
        <ConfirmDialog
          title={
            {
              purge: '彻底删除这条记录？',
              trash: '移入回收站？',
              publish: '公开展示这条记录？',
              unpublish: '取消公开展示？',
            }[dialog]
          }
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={() => act(dialog)}
          confirmLabel={
            {
              purge: '彻底删除',
              trash: '移入回收站',
              publish: '确认公开',
              unpublish: '取消公开',
            }[dialog]
          }
        >
          <p>
            {dialog === 'publish'
              ? `“${record.title}”的标题、标签、正文、封面和来源昵称会显示在首页与公开列表，所有访客均可阅读。之后保存的修改也会同步到公开页面。`
              : dialog === 'unpublish'
                ? '取消后不再向访客提供这条练习。已被他人保存的内容无法收回。'
                : dialog === 'purge'
                  ? '这将永久删除记录，并清理不再使用的封面，无法恢复。'
                  : '记录将从列表隐藏。你可以在回收站恢复，封面也会保留。'}
          </p>
        </ConfirmDialog>
      )}
    </main>
  )
}
