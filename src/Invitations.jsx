import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { useAuth } from './lib/authContext.js'
import { useNoteAccess } from './lib/useNoteAccess.js'
import {
  invitationStatus,
  normalizeInvitationCode,
  randomInvitationCode,
} from './lib/accountUtils.js'
import { errorText, formatDate } from './lib/recordUtils.js'
import RecordsLayout, { RecordsAccess } from './RecordsLayout.jsx'
import { NoteAccessMessage } from './NoteAccess.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'

export default function Invitations({ manage }) {
  return manage ? <ManageInvitations /> : <ActivateNotes />
}

export function ActivateNotes() {
  return (
    <RecordsLayout
      title="开通笔记"
      description="注册后兑换作者发出的邀请码，开始记录自己的笔记。"
      back="/?view=account"
      backLabel="返回我的账号"
    >
      <RecordsAccess>{() => <ActivationForm />}</RecordsAccess>
    </RecordsLayout>
  )
}

function ActivationForm() {
  const access = useNoteAccess()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const lock = useRef(false)
  async function redeem(event) {
    event.preventDefault()
    if (lock.current) return
    const code = normalizeInvitationCode(
      String(new FormData(event.currentTarget).get('code')),
    )
    if (!/^[0-9A-F]{32}$/.test(code)) {
      setMessage('请输入完整的 32 位邀请码，可以保留分隔横线。')
      return
    }
    lock.current = true
    setBusy(true)
    setMessage('')
    try {
      const { data, error } = await supabase
        .rpc('redeem_note_invitation', { p_code: code })
        .retry(false)
      if (error) throw error
      if (!data.ok) throw new Error(data.message)
      event.target.reset()
      access.retry()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  if (access.loading || access.error)
    return <NoteAccessMessage access={access} />
  if (access.data?.can_write)
    return (
      <div className="notice">
        <p>笔记记录功能已开通，可以创建自己的私密笔记。</p>
        <a className="record-create-link" href="/?view=records">
          前往我的记录
        </a>
      </div>
    )
  if (!access.data?.email_verified)
    return (
      <div className="notice">
        <p>请先验证邮箱，再兑换邀请码。</p>
        <a className="record-create-link" href="/?view=verify-email">
          发送验证邮件
        </a>
      </div>
    )
  return (
    <form className="record-fields auth-form" onSubmit={redeem}>
      <p className="helper">
        每个邀请码仅供一个账号兑换。兑换成功后，笔记和封面只属于你的账号。
      </p>
      <label htmlFor="invite-code">邀请码</label>
      <input
        id="invite-code"
        name="code"
        autoComplete="off"
        maxLength={80}
        required
        disabled={busy}
        spellCheck={false}
      />
      <button disabled={busy}>{busy ? '正在兑换…' : '兑换邀请码'}</button>
      {message && <p role="alert">{message}</p>}
    </form>
  )
}

export function ManageInvitations() {
  return (
    <RecordsLayout
      title="邀请管理"
      description="生成随机邀请码，邀请朋友开通自己的笔记空间。"
      back="/?view=account"
      backLabel="返回我的账号"
    >
      <RecordsAccess>{() => <InvitationManager />}</RecordsAccess>
    </RecordsLayout>
  )
}

function InvitationManager() {
  const auth = useAuth()
  const access = useNoteAccess()
  const [rows, setRows] = useState([])
  const [more, setMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [listError, setListError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [days, setDays] = useState('7')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(null)
  const [issued, setIssued] = useState(null)
  const [dialog, setDialog] = useState(null)
  const lock = useRef(false)
  const author = access.data?.is_author
  useEffect(() => {
    if (!author) return
    let active = true
    supabase
      .rpc('list_note_invitations')
      .retry(false)
      .then(({ data, error }) => {
        if (!active) return
        if (error) setListError(errorText(error))
        else {
          setRows(data.slice(0, 20))
          setMore(data.length > 20)
          setListError('')
          setLoaded(true)
        }
      })
      .catch((error) => {
        if (active) setListError(errorText(error))
      })
    return () => {
      active = false
    }
  }, [author, attempt])
  async function loadMore() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setListError('')
    try {
      const last = rows.at(-1)
      const { data, error } = await supabase
        .rpc('list_note_invitations', {
          p_before_created_at: last.created_at,
          p_before_id: last.id,
        })
        .retry(false)
      if (error) throw error
      setRows((old) => [
        ...old,
        ...data
          .slice(0, 20)
          .filter((row) => !old.some((item) => item.id === row.id)),
      ])
      setMore(data.length > 20)
    } catch (error) {
      setListError(errorText(error))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function issue() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setMessage('')
    const request = pending || {
      id: crypto.randomUUID(),
      code: randomInvitationCode(),
      days: Number(days),
    }
    setPending(request)
    try {
      const { data: account, error: accountError } =
        await supabase.auth.getUser()
      if (accountError) throw accountError
      if (account.user?.id !== auth.user.id)
        throw new Error('账号已变化，请重新登录。')
      const { data, error } = await supabase
        .rpc('issue_note_invitation', {
          p_id: request.id,
          p_code: request.code,
          p_days: request.days,
        })
        .retry(false)
      if (error) throw error
      setIssued({ ...data, code: request.code.match(/.{1,8}/g).join('-') })
      setPending(null)
      setAttempt((n) => n + 1)
    } catch (error) {
      setMessage(
        `${errorText(error)} 可以重试本次生成；如果离开页面导致原码丢失，请在列表中撤销该邀请。`,
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function revoke() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setMessage('')
    try {
      const { error } = await supabase
        .rpc('revoke_note_invitation', { p_id: dialog })
        .retry(false)
      if (error) throw error
      if (issued?.id === dialog) setIssued(null)
      setDialog(null)
      setAttempt((n) => n + 1)
      setMessage('邀请码已撤销。')
    } catch (error) {
      setMessage(errorText(error))
      setDialog(null)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.code)
      setMessage('邀请码已复制，可以发给受邀请的人。')
    } catch {
      setMessage('未能自动复制，请选中邀请码手动复制。')
    }
  }
  if (access.loading || access.error)
    return <NoteAccessMessage access={access} />
  if (!author) return <p className="notice">邀请管理仅对网站作者开放。</p>
  return (
    <>
      <div className="maintenance-panel">
        <h2>生成邀请码</h2>
        <p>一码一人，兑换后永久开通该账号的笔记功能。有效期只限制兑换时间。</p>
        <div className="record-fields">
          <label htmlFor="invite-days">兑换有效期</label>
          <select
            id="invite-days"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            disabled={busy || !!pending}
          >
            <option value="7">7 天</option>
            <option value="30">30 天</option>
          </select>
          <button disabled={busy} onClick={issue}>
            {busy ? '正在处理…' : pending ? '重试本次生成' : '生成随机邀请码'}
          </button>
        </div>
        {issued && (
          <div className="share-link-field">
            <label htmlFor="generated-code">本次邀请码</label>
            <input
              id="generated-code"
              readOnly
              value={issued.code}
              onFocus={(e) => e.target.select()}
            />
            <small>
              截至 {formatDate(issued.expires_at)}{' '}
              可兑换。请先复制；离开页面后不再显示原码。
            </small>
            <button onClick={copy} disabled={busy}>
              复制邀请码
            </button>
          </div>
        )}
        {message && <p role="status">{message}</p>}
      </div>
      <h2 className="results-heading">邀请记录</h2>
      {!loaded && !listError && <p role="status">正在读取邀请…</p>}
      {loaded && !rows.length && (
        <p className="empty-state">还没有发出邀请。</p>
      )}
      <div className="invitation-list">
        {rows.map((row) => (
          <div className="invitation-row" key={row.id}>
            <div>
              <strong>{invitationStatus(row)}</strong>
              <p>生成于 {formatDate(row.created_at)}</p>
              <small>
                有效期至 {formatDate(row.expires_at)} · 编号{' '}
                {row.id.slice(0, 8)}
              </small>
            </div>
            {invitationStatus(row) === '待兑换' && (
              <button
                className="secondary-button"
                disabled={busy || !!pending}
                onClick={() => setDialog(row.id)}
              >
                撤销邀请
              </button>
            )}
          </div>
        ))}
      </div>
      {listError && (
        <p role="alert">
          {listError}{' '}
          <button
            onClick={() =>
              loaded && more ? loadMore() : setAttempt((n) => n + 1)
            }
            disabled={busy}
          >
            重试邀请列表
          </button>
        </p>
      )}
      {more && !listError && (
        <button className="load-more" onClick={loadMore} disabled={busy}>
          加载更多邀请
        </button>
      )}
      {dialog && (
        <ConfirmDialog
          title="撤销这条邀请？"
          onConfirm={revoke}
          onClose={() => setDialog(null)}
          busy={busy}
          confirmLabel="撤销邀请"
        >
          <p>撤销后该邀请码不能再兑换。已经兑换的账号不受影响。</p>
        </ConfirmDialog>
      )}
    </>
  )
}
