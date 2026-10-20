import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import {
  cleanupFiles,
  currentUser,
  getRecord,
  mutateRecord,
  prepareCover,
  queueCleanup,
} from './lib/recordsApi.js'
import {
  draftKey,
  readLocal,
  removeLocal,
  writeLocal,
} from './lib/localData.js'
import {
  EMPTY_FORM,
  errorText,
  formatDate,
  validateRecord,
} from './lib/recordUtils.js'
import RecordThumbnail from './RecordThumbnail.jsx'
import { listReturn, loginLink, recordLink } from './lib/navigation.js'
import PageTopbar from './PageTopbar.jsx'

const MarkdownContent = lazy(() => import('./MarkdownContent.jsx'))

export default function RecordEditor({ recordId }) {
  const [loaded, setLoaded] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const user = await currentUser()
        if (!user) {
          if (active) setLoaded({ signedOut: true })
          return
        }
        const record = recordId ? await getRecord(recordId) : null
        if (recordId && (!record || record.deleted_at))
          throw new Error('记录不存在或已移入回收站。')
        if (active)
          setLoaded({
            user,
            record,
            draft: readLocal(draftKey(user.id, recordId)),
          })
      } catch (err) {
        if (active) setError(errorText(err))
      }
    }
    load()
    return () => {
      active = false
    }
  }, [recordId, attempt])
  const returnTo = listReturn(
    new URLSearchParams(window.location.search).get('back'),
  )
  const back = recordId
    ? recordLink(recordId, { back: returnTo, manage: true })
    : returnTo
  if (!loaded)
    return (
      <main className="record-page">
        <PageTopbar back={back} backLabel="返回" />
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              onClick={() => {
                setError('')
                setAttempt((n) => n + 1)
              }}
            >
              重新读取
            </button>
          </>
        ) : (
          <p role="status">正在准备编辑器…</p>
        )}
      </main>
    )
  if (loaded.signedOut)
    return (
      <main className="record-page">
        <PageTopbar back={back} backLabel="返回" />
        <h1>请先登录</h1>
        <a
          className="record-create-link"
          href={loginLink(window.location.pathname + window.location.search)}
        >
          去登录
        </a>
      </main>
    )
  return (
    <EditorForm
      key={`${loaded.user.id}:${recordId || 'new'}`}
      {...loaded}
      back={back}
    />
  )
}

function EditorForm({ user, record, draft, back }) {
  const baseline = {
    title: record?.title || '',
    tags: record?.tags.join(', ') || '',
    content: record?.content || '',
    removeCover: false,
  }
  const [form, setForm] = useState(baseline)
  const [candidate, setCandidate] = useState(draft)
  const [draftId, setDraftId] = useState(
    () => draft?.recordId || record?.id || crypto.randomUUID(),
  )
  const [baseVersion, setBaseVersion] = useState(record?.version ?? null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [uploadedPath, setUploadedPath] = useState(null)
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [draftMessage, setDraftMessage] = useState('')
  const [saved, setSaved] = useState(false)
  const [contentView, setContentView] = useState('write')
  const saving = useRef(false)
  const completed = useRef(false)
  const uploadIntent = useRef(draft?.uploadIntent || null)
  const imageGeneration = useRef(0)
  const input = useRef(null)
  const key = draftKey(user.id, record?.id)
  const dirty =
    JSON.stringify(form) !== JSON.stringify(baseline) ||
    !!file ||
    !!uploadedPath ||
    !!pending
  const disabled = busy || !!pending || !!candidate
  const lastDraft = useRef(null)
  useEffect(() => {
    lastDraft.current =
      !candidate && dirty && !saved
        ? {
            form,
            recordId: draftId,
            baseVersion,
            uploadedPath,
            uploadIntent: uploadIntent.current,
            pending,
            savedAt: new Date().toISOString(),
          }
        : null
  }, [
    candidate,
    dirty,
    saved,
    form,
    draftId,
    baseVersion,
    uploadedPath,
    pending,
  ])
  useEffect(
    () => () => {
      // An auth change can unmount the editor without a document unload event.
      if (!completed.current && lastDraft.current) {
        try {
          writeLocal(key, lastDraft.current)
        } catch {
          /* the visible storage error already explains the limitation */
        }
      }
    },
    [key],
  )

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview],
  )
  useEffect(
    () => () => {
      imageGeneration.current += 1
    },
    [],
  )
  useEffect(() => {
    if (candidate || saved) return
    const timer = setTimeout(() => {
      try {
        if (!dirty) {
          removeLocal(key)
          return
        }
        writeLocal(key, {
          form,
          recordId: draftId,
          baseVersion,
          uploadedPath,
          uploadIntent: uploadIntent.current,
          pending,
          savedAt: new Date().toISOString(),
        })
        setDraftMessage('文字草稿已保存在此浏览器。尚未上传的图片需重新选择。')
      } catch {
        setDraftMessage('本机草稿保存失败，可能存储空间不足，请复制重要内容。')
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [
    form,
    dirty,
    candidate,
    saved,
    key,
    draftId,
    baseVersion,
    uploadedPath,
    pending,
  ])
  useEffect(() => {
    if (!dirty || saved) return
    const warn = (event) => {
      if (completed.current) return
      try {
        writeLocal(key, {
          form,
          recordId: draftId,
          baseVersion,
          uploadedPath,
          uploadIntent: uploadIntent.current,
          pending,
          savedAt: new Date().toISOString(),
        })
      } catch {
        /* the native leave warning still protects unsaved input */
      }
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, saved, key, form, draftId, baseVersion, uploadedPath, pending])

  function persist(nextPending, path = uploadedPath) {
    writeLocal(key, {
      form,
      recordId: draftId,
      baseVersion,
      uploadedPath: path,
      uploadIntent: uploadIntent.current,
      pending: nextPending,
      savedAt: new Date().toISOString(),
    })
  }
  async function recover() {
    let recoveredPath = candidate.uploadedPath || null
    if (!recoveredPath && candidate.uploadIntent) {
      try {
        const { data: exists, error } = await supabase.storage
          .from('record-covers')
          .exists(candidate.uploadIntent)
        if (exists) recoveredPath = candidate.uploadIntent
        else if (
          error &&
          !['400', '404'].includes(String(error.statusCode || error.status))
        )
          throw error
      } catch (err) {
        setMessage(
          `无法确认上次图片上传结果：${errorText(err)} 请稍后再恢复草稿。`,
        )
        return
      }
    }
    setForm({ ...EMPTY_FORM, ...candidate.form })
    setDraftId(candidate.recordId)
    setBaseVersion(candidate.baseVersion)
    setUploadedPath(recoveredPath)
    setPending(candidate.pending || null)
    if (record && candidate.baseVersion !== record.version)
      setMessage(
        '这份草稿基于旧版本。请先复制需要的文字，再重新载入编辑，避免覆盖其他设备修改。',
      )
    setCandidate(null)
  }
  function discard() {
    if (candidate?.pending) return
    try {
      if (candidate?.uploadedPath || candidate?.uploadIntent)
        queueCleanup(user.id, candidate.uploadedPath || candidate.uploadIntent)
      uploadIntent.current = null
      removeLocal(key)
      setCandidate(null)
      if (!record) setDraftId(crypto.randomUUID())
    } catch {
      setMessage('无法清除本机草稿，请检查浏览器存储设置。')
    }
  }
  async function chooseCover(event) {
    const selected = event.target.files[0]
    if (!selected) return
    const generation = ++imageGeneration.current
    setImageBusy(true)
    setMessage('')
    try {
      const compressed = await prepareCover(selected)
      if (generation !== imageGeneration.current) return
      if (uploadedPath || uploadIntent.current)
        queueCleanup(user.id, uploadedPath || uploadIntent.current)
      uploadIntent.current = null
      setUploadedPath(null)
      setFile(compressed)
      setPreview(URL.createObjectURL(compressed))
      setForm((f) => ({ ...f, removeCover: false }))
      setMessage(
        `封面已处理：${Math.round(selected.size / 1024)} KB → ${Math.round(compressed.size / 1024)} KB。`,
      )
    } catch (err) {
      if (generation === imageGeneration.current) setMessage(errorText(err))
    } finally {
      if (generation === imageGeneration.current) setImageBusy(false)
    }
  }
  function removeCover() {
    imageGeneration.current += 1
    if (uploadedPath || uploadIntent.current)
      queueCleanup(user.id, uploadedPath || uploadIntent.current)
    uploadIntent.current = null
    setUploadedPath(null)
    setFile(null)
    setPreview('')
    setImageBusy(false)
    setForm((f) => ({ ...f, removeCover: true }))
    if (input.current) input.current.value = ''
  }
  async function submit(event) {
    event.preventDefault()
    if (saving.current || imageBusy || candidate) return
    saving.current = true
    setBusy(true)
    setMessage('')
    let request = pending
    try {
      const values = validateRecord(form)
      const verified = await currentUser()
      if (!verified || verified.id !== user.id)
        throw new Error('账号状态已变化，请重新登录。草稿仍保留在原账号下。')
      if (!request) {
        let path = form.removeCover
          ? null
          : uploadedPath || record?.cover_path || null
        if (file && !uploadedPath) {
          setMessage('正在上传封面…')
          path =
            uploadIntent.current || `${user.id}/${crypto.randomUUID()}.webp`
          uploadIntent.current = path
          writeLocal(key, {
            form,
            recordId: draftId,
            baseVersion,
            uploadedPath: null,
            uploadIntent: path,
            savedAt: new Date().toISOString(),
          })
          const { error } = await supabase.storage
            .from('record-covers')
            .upload(path, file, { contentType: file.type, upsert: false })
          if (error) {
            if (String(error.statusCode) !== '409') throw error
            const { data: exists, error: existsError } = await supabase.storage
              .from('record-covers')
              .exists(path)
            if (existsError || !exists) throw error
          }
          setUploadedPath(path)
          persist(null, path)
        }
        request = {
          requestId: crypto.randomUUID(),
          action: record ? 'update' : 'create',
          recordId: draftId,
          version: baseVersion,
          ...values,
          coverPath: path,
        }
        persist(request, path && path !== record?.cover_path ? path : null)
        setPending(request)
      }
      setMessage('正在保存记录…')
      const result = await mutateRecord(request)
      setMessage('记录已保存，正在处理旧封面…')
      let notice = ''
      try {
        if (
          result.old_cover_path &&
          result.old_cover_path !== result.record.cover_path
        )
          queueCleanup(user.id, result.old_cover_path)
        const remaining = await cleanupFiles(user.id)
        if (remaining)
          notice =
            '记录已保存，旧图片清理尚未完成，可前往记录管理中的封面清理重试。'
        removeLocal(key)
      } catch {
        notice = '记录已保存，本机草稿或旧图片清理未完成。'
      }
      completed.current = true
      setSaved(true)
      setPending(null)
      window.location.assign(
        recordLink(result.record.id, {
          back: listReturn(
            new URLSearchParams(window.location.search).get('back'),
          ),
          notice,
        }),
      )
    } catch (err) {
      if (err.code) {
        setPending(null)
        try {
          persist(
            null,
            request?.coverPath && request.coverPath !== record?.cover_path
              ? request.coverPath
              : uploadedPath,
          )
        } catch {
          /* leave saved draft intact */
        }
      }
      setMessage(
        `${errorText(err)}${request && !err.code ? ' 可重试上次保存；内容已锁定，避免产生重复记录。' : ''}`,
      )
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  return (
    <main className="record-page">
      <PageTopbar
        back={back}
        backLabel={`返回${record ? '记录管理' : '记录列表'}`}
        onBack={(e) => {
          if (!dirty || saved) return
          if (
            !window.confirm(
              '尚有未保存内容，离开后可恢复本机文字草稿。仍要离开吗？',
            )
          ) {
            e.preventDefault()
            return
          }
          try {
            persist(pending)
            completed.current = true
          } catch {
            e.preventDefault()
            setMessage('草稿保存失败，请先复制重要内容。')
          }
        }}
      />
      <div className="record-editor">
        <h1>{record ? '编辑记录' : '新增记录'}</h1>
        <p className="helper">
          {record?.is_public
            ? '这条记录已公开，保存的修改也会更新公开内容。'
            : '记录默认仅自己可见。保存后可在记录管理页选择公开展示。'}
        </p>
        {candidate && (
          <aside className="notice">
            <p>
              发现 {formatDate(candidate.savedAt)} 的本机草稿。
              {candidate.pending ? '上次保存结果待确认，请恢复后重试。' : ''}
            </p>
            <div className="actions">
              <button onClick={recover}>恢复草稿</button>
              <button onClick={discard} disabled={!!candidate.pending}>
                丢弃草稿
              </button>
            </div>
          </aside>
        )}
        <form className="record-fields" onSubmit={submit}>
          <label htmlFor="record-title">标题</label>
          <input
            id="record-title"
            name="title"
            maxLength={160}
            required
            disabled={disabled}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <label htmlFor="record-tags">
            标签 <small>中英文逗号分隔，最多 12 个</small>
          </label>
          <input
            id="record-tags"
            name="tags"
            disabled={disabled}
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
          />
          <label htmlFor="record-content">详细内容</label>
          <div className="content-mode" role="group" aria-label="正文显示模式">
            <button
              type="button"
              aria-pressed={contentView === 'write'}
              onClick={() => setContentView('write')}
            >
              写作
            </button>
            <button
              type="button"
              aria-pressed={contentView === 'preview'}
              onClick={() => setContentView('preview')}
            >
              预览
            </button>
            <a
              className="text-link"
              href="/?view=markdown-help"
              target="_blank"
              rel="noopener noreferrer"
            >
              写作说明 ↗
            </a>
          </div>
          <small id="record-content-help">
            支持 Markdown 和数学公式：行内用 <code>$x^2$</code>，独立公式用两个单独成行的 <code>$$</code> 包围。切换到预览查看效果。
          </small>
          <textarea
            id="record-content"
            name="content"
            aria-describedby="record-content-help"
            rows={10}
            maxLength={100000}
            disabled={disabled}
            hidden={contentView !== 'write'}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
          {contentView === 'preview' && (
            <div className="markdown-preview" aria-label="正文预览">
              {form.content ? (
                <Suspense fallback={<p role="status">正在准备预览…</p>}>
                  <MarkdownContent content={form.content} />
                </Suspense>
              ) : (
                <p className="helper">还没有正文，切回写作输入内容。</p>
              )}
            </div>
          )}
          <label htmlFor="record-cover">封面（可选）</label>
          <input
            ref={input}
            id="record-cover"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={disabled || imageBusy}
            onChange={chooseCover}
          />
          <small>
            JPEG、PNG、WebP，原图不超过 5 MB；自动缩小至最长边 1600 像素并压缩。
          </small>
          {imageBusy && <p role="status">正在处理图片…</p>}
          {preview ? (
            <img className="cover-preview" src={preview} alt="将保存的封面" />
          ) : !form.removeCover && (uploadedPath || record?.cover_path) ? (
            <RecordThumbnail
              key={uploadedPath || record.cover_path}
              coverPath={uploadedPath || record.cover_path}
            />
          ) : null}
          {(preview ||
            uploadedPath ||
            (record?.cover_path && !form.removeCover)) && (
            <button
              type="button"
              className="secondary-button"
              disabled={disabled || imageBusy}
              onClick={removeCover}
            >
              移除封面
            </button>
          )}
          {form.removeCover && <small>保存后将移除原封面。</small>}
          <div className="actions">
            <button
              className="login-submit"
              disabled={busy || imageBusy || !!candidate}
              type="submit"
            >
              {busy
                ? '正在保存…'
                : pending
                  ? '重试上次保存'
                  : record
                    ? '保存修改'
                    : '保存记录'}
            </button>
          </div>
          <p className="login-message" role="status">
            {message}
          </p>
          <small role="status">{draftMessage}</small>
          <small>
            草稿仅保存在当前设备浏览器中，按账号隔离；不会同步到其他设备。
          </small>
        </form>
      </div>
    </main>
  )
}
