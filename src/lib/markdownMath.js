import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

export { remarkMath }
export const katexPlugin = [rehypeKatex, { trust: false, strict: 'ignore', maxSize: 20, maxExpand: 1000 }]
