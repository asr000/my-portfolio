import { useMemo, useState } from 'react'
import PageTopbar from './PageTopbar.jsx'
import friendLinks from './lib/friendLinks.js'
import HelpHint from './HelpHint.jsx'
import './friendsPage.css'

function siteCardText() {
  const website = window.location.origin
  return [
    'title: Re:代码生活',
    'description: 记录项目、学习与每一次进步。',
    `website: ${website}`,
    `image: ${new URL('/apple-touch-icon.png', website).href}`,
  ].join('\n')
}

export default function FriendsPage() {
  const [query, setQuery] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const filteredLinks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return friendLinks
    return friendLinks.filter((friend) =>
      [friend.name, friend.description, friend.url, ...(friend.tags || [])]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalized),
    )
  }, [query])

  async function copySiteCard() {
    try {
      await navigator.clipboard.writeText(siteCardText())
      setCopyMessage('本站信息已复制。')
    } catch {
      setCopyMessage('复制失败，请检查浏览器剪贴板权限。')
    }
  }

  return (
    <main className="record-page friends-page">
      <PageTopbar back="/" backLabel="返回主页" />
      <div className="friends-content">
        <header className="friends-heading">
          <span className="friends-eyebrow">A SMALL CORNER ON THE WEB</span>
          <h1>朋链 <span>| Friends</span></h1>
          <HelpHint align="start">收藏一些喜欢的小站，也欢迎你把自己的角落介绍给我。</HelpHint>
        </header>

        <section className="friends-profile" aria-labelledby="friends-profile-title">
          <div className="friends-profile-copy">
            <span className="friends-section-label">LINK EXCHANGE</span>
            <h2 id="friends-profile-title">本站信息</h2>
            <HelpHint align="start">如果想添加本站为友链，可以复制下面的信息。</HelpHint>
            <pre><code>{siteCardText()}</code></pre>
            <button type="button" onClick={copySiteCard}>复制本站信息</button>
            {copyMessage && <p className="friends-copy-message" role="status">{copyMessage}</p>}
          </div>
          <div className="friends-profile-mark" aria-hidden="true">
            <img src="/apple-touch-icon.png" alt="" />
            <span>Re:</span>
          </div>
        </section>

        <section className="friends-directory" aria-labelledby="friends-directory-title">
          <div className="friends-directory-heading">
            <div>
              <span className="friends-section-label">GOOD PEOPLE, GOOD SITES</span>
              <h2 id="friends-directory-title">朋友们的小站</h2>
            </div>
            <label className="friends-search">
              <span className="sr-only">搜索友链</span>
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="10.8" cy="10.8" r="6.8" />
                <path d="m16 16 4.2 4.2" />
              </svg>
              <input
                type="search"
                value={query}
                placeholder="搜索名字、简介或标签"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>

          {filteredLinks.length > 0 ? (
            <div className="friends-grid">
              {filteredLinks.map((friend) => (
                <a
                  className="friend-card"
                  href={friend.url}
                  key={friend.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="friend-card-avatar">
                    {friend.avatar ? <img src={friend.avatar} alt="" /> : friend.name.slice(0, 1)}
                  </span>
                  <span className="friend-card-copy">
                    <strong>{friend.name}</strong>
                    <span>{friend.description}</span>
                    <small>{new URL(friend.url).hostname}</small>
                  </span>
                  <span className="friend-card-arrow" aria-hidden="true">↗</span>
                </a>
              ))}
            </div>
          ) : (
            <div className="friends-empty" role="status">
              <span className="friends-empty-icon" aria-hidden="true">✳</span>
              <strong>{query ? '没有找到匹配的小站' : '友链名单正在整理中'}</strong>
              <span>{query ? '换个关键词试试。' : '这里会收录朋友们的网站。'}</span>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
