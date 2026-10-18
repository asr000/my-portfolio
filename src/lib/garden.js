// Keep these twelve entries in order: their indexes are saved with each daily draw.
export const FORTUNES = [
  { title: '破土', text: '不必一下子长成大树。今天，把第一行写下来。', task: '试着把一个想法写成三句话。' },
  { title: '向阳', text: '还没弄懂的地方，也正在带你走向新的答案。', task: '给今天学会的知识举一个小例子。' },
  { title: '生根', text: '慢一点没关系，理解会在看不见的地方扎根。', task: '回头解释一个以前只会照写的步骤。' },
  { title: '新芽', text: '昨天的问题，可能是今天的灵感。', task: '翻开一篇旧笔记，补上一句新的理解。' },
  { title: '晴日', text: '今天适合动手。让一个小想法真的跑起来。', task: '完成一个只需要十分钟的小实验。' },
  { title: '微风', text: '卡住的时候，换个角度，路也许就在旁边。', task: '用纸笔画出当前问题的输入和输出。' },
  { title: '花信', text: '把收获分享出去，也是在为别人留下一粒种子。', task: '整理一条愿意公开分享的小经验。' },
  { title: '雨后', text: '报错也会留下养分。今天的失败不会白费。', task: '记下一个报错，以及你怎么找到原因。' },
  { title: '留白', text: '休息也是生长的一部分，给自己一点空白。', task: '离开屏幕走一走，再回来读一段代码。' },
  { title: '枝叶', text: '零散的知识，正在慢慢连成你的地图。', task: '找出今天所学和旧知识的一处联系。' },
  { title: '结伴', text: '一句提问，或许能让两个人都向前一步。', task: '读一篇别人的公开练习，带走一个想法。' },
  { title: '常青', text: '不用每天都惊艳，持续的小步也会走得很远。', task: '给明天的自己留下一个具体的小目标。' },
]

export function plantStage(count) {
  return count >= 6 ? 'flower' : count >= 3 ? 'leaf' : 'sprout'
}

export function gardenError(error) {
  return ['PGRST202', '42883'].includes(error?.code)
    ? '花园正在准备中，稍后再来看看。'
    : '暂时没能连上花园，请稍后重试。'
}

export function publicTagLink(tag) {
  return `/?${new URLSearchParams({ view: 'showcase', ...(tag && { tag }) })}`
}
