import RecordsLayout from './RecordsLayout.jsx'

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
      </div>
    </RecordsLayout>
  )
}
