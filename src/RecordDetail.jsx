import { useEffect, useRef, useState } from 'react'
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
import { listReturn, recordLink } from './lib/navigation.js'

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
  const locked = useRef(false)
  const cover = useCover(manage ? null : record?.cover_path)
  const params = new URLSearchParams(window.location.search)
  const back = listReturn(
    params.get('back'),
    record?.deleted_at ? 'trash' : 'records',
  )
  const detailHref = recordLink(recordId, { back })
  const manageHref = recordLink(recordId, { back, manage: true })
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
          setStatus(data ? 'ready' : 'not-found')
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
  }, [recordId, reload])
  async function act(action) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setActionMessage('')
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
        if (await cleanupFiles(user.id))
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
        setActionMessage(notice || '记录已恢复。')
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
      setActionMessage(
        `${errorText(err)}${!err.code ? ' 如结果不确定，请重试原操作。' : ''}`,
      )
      setDialog(null)
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  const notice = new URLSearchParams(window.location.search).get('notice')
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
        <a className="record-create-link" href="/?login=1">
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
              <p className="record-content">{record.content}</p>
            </>
          )}
        </article>
      )}
      {dialog && (
        <ConfirmDialog
          title={dialog === 'purge' ? '彻底删除这条记录？' : '移入回收站？'}
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={() => act(dialog)}
          confirmLabel={dialog === 'purge' ? '彻底删除' : '移入回收站'}
        >
          <p>
            {dialog === 'purge'
              ? '这将永久删除记录，并清理不再使用的封面，无法恢复。'
              : '记录将从列表隐藏。你可以在回收站恢复，封面也会保留。'}
          </p>
        </ConfirmDialog>
      )}
    </main>
  )
}
