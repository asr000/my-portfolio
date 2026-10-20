import { lazy, Suspense } from 'react'
import RecordsLayout from './RecordsLayout.jsx'

const MarkdownContent = lazy(() => import('./MarkdownContent.jsx'))
const mathExamples = [
  { title: '行内公式', content: '勾股定理：$a^2 + b^2 = c^2$。' },
  {
    title: '独立公式：分式、根号与求和',
    content: String.raw`$$
\sqrt{\frac{1}{n}\sum_{i=1}^{n} x_i^2}
$$`,
  },
  {
    title: '多行对齐',
    content: String.raw`$$
\begin{aligned}
(a+b)^2 &= a^2 + 2ab + b^2 \\
(a-b)^2 &= a^2 - 2ab + b^2
\end{aligned}
$$`,
  },
  {
    title: '矩阵',
    content: String.raw`$$
A = \begin{bmatrix}
1 & 2 \\
3 & 4
\end{bmatrix}
$$`,
  },
  {
    title: '分段函数',
    content: String.raw`$$
|x| = \begin{cases}
x, & x \ge 0 \\
-x, & x < 0
\end{cases}
$$`,
  },
]

export default function MarkdownHelp() {
  return (
    <RecordsLayout
      title="Markdown 写作说明"
      description="在详细内容里输入这些符号，切换到预览查看效果。"
    >
      <div className="maintenance-panel markdown-help">
        <h2>常用写法</h2>
        <dl>
          <dt>标题</dt>
          <dd>
            <code># 一级标题</code>
            <br />
            <code>## 二级标题</code>
          </dd>
          <dt>强调</dt>
          <dd>
            <code>**加粗文字**</code>，<code>*斜体文字*</code>
          </dd>
          <dt>列表</dt>
          <dd>
            <code>- 列表项</code>，<code>1. 有序列表项</code>
          </dd>
          <dt>链接和图片</dt>
          <dd>
            <code>[链接文字](https://example.com)</code>
            <br />
            <code>![图片说明](https://example.com/image.png)</code>
          </dd>
          <dt>代码</dt>
          <dd>
            <code>`行内代码`</code>
            ；多行代码用三个反引号包围，并在开头标注语言。
          </dd>
        </dl>
        <pre>
          <code>{'```python\nprint("Hello, world!")\n```'}</code>
        </pre>
        <p className="helper">
          支持表格、任务列表和删除线。HTML
          标签不会执行；不支持的代码语言会以普通代码显示。
        </p>
        <h2>数学公式</h2>
        <p className="helper">
          行内公式用一对 <code>$</code> 包围；独立公式的开头和结尾各放一行 <code>$$</code>。
          下面的示例可直接复制到正文，编辑预览、保存后的笔记和公开阅读页都会显示公式。
        </p>
        {mathExamples.map(({ title, content }) => (
          <div key={title}>
            <h3>{title}</h3>
            <pre><code>{content}</code></pre>
            <div className="math-example">
              <Suspense fallback={<p role="status">正在准备公式示例…</p>}>
                <MarkdownContent content={content} />
              </Suspense>
            </div>
          </div>
        ))}
        <p className="helper">
          <code>{String.raw`\int`}</code>、<code>{String.raw`\vec{a}`}</code>、
          <code>{String.raw`\mathbb{R}`}</code> 等常用数学命令也可以使用。
          数学环境要放在公式分隔符内；这里只支持数学公式，不支持完整 LaTeX 文档或自定义宏包。
        </p>
        <p className="helper">
          代码里的公式会保留原文。普通文字要显示美元符号时写 <code>{String.raw`\$`}</code>。
          公式写错或命令不支持时会保留错误内容，其他正文仍可阅读；可对照示例修改后再次预览。
        </p>
      </div>
    </RecordsLayout>
  )
}
