import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import cpp from 'highlight.js/lib/languages/cpp'
import c from 'highlight.js/lib/languages/c'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import sql from 'highlight.js/lib/languages/sql'
import 'highlight.js/styles/github-dark.css'

const highlight = [
  [
    rehypeHighlight,
    {
      detect: false,
      languages: {
        javascript,
        typescript,
        python,
        cpp,
        c,
        css,
        xml,
        json,
        bash,
        sql,
      },
    },
  ],
]
const components = {
  // Raw HTML is disabled below. Keep URLs filtered by react-markdown's default policy.
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
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
  return (
    <div className="markdown-body">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={highlight}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
