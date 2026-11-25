import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const components = {
  // Raw HTML is disabled below. Keep URLs filtered by react-markdown's default policy.
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt, title }) =>
    src ? (
      <img src={src} alt={alt || '正文图片'} title={title} loading="lazy" />
    ) : (
      <span>{alt || '正文图片'}</span>
    ),
}

export default function MarkdownContent({ content }) {
  const [math, setMath] = useState(null)
  const [highlight, setHighlight] = useState(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const needsMath = content.includes('$')
  const needsHighlight = /`{3,}|~{3,}/.test(content)

  useEffect(() => {
    let active = true
    if (needsMath && !math) {
      import('./lib/markdownMath.js')
        .then((module) => { if (active) setMath(module) })
        .catch(() => { if (active) setFailed(true) })
    }
    if (needsHighlight && !highlight) {
      import('./lib/markdownHighlight.js')
        .then((module) => { if (active) setHighlight(module) })
        .catch(() => { if (active) setFailed(true) })
    }
    return () => { active = false }
  }, [needsMath, needsHighlight, math, highlight, attempt])

  const remarkPlugins = [remarkGfm]
  const rehypePlugins = []
  if (needsMath && math) {
    remarkPlugins.push(math.remarkMath)
    rehypePlugins.push(math.katexPlugin)
  }
  if (needsHighlight && highlight) rehypePlugins.push(highlight.highlightPlugin)

  return (
    <div className="markdown-body">
      {failed && (
        <p role="status">
          公式或代码样式暂时无法加载。{' '}
          <button type="button" onClick={() => { setFailed(false); setAttempt((value) => value + 1) }}>重试</button>
        </p>
      )}
      <ReactMarkdown skipHtml remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
