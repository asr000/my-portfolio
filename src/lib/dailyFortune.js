// Keep these twelve entries in order: their indexes are saved with each daily draw.
export const FORTUNES = [
  { title: '😃', luck: '小吉', outlook: '"夢の終わりは新たな始ま。"', text: '', task: '小睡一会.' },
  { title: '😆', luck: '中吉', outlook: '思路渐明，适合把好奇心变成一次探索。', text: '还没弄懂的地方，也正在带你走向新的答案。', task: '给今天学会的知识举一个小例子。' },
  { title: '🙂', luck: '平', outlook: '宜稳不宜急，打牢基础就是今天的收获。', text: '慢一点没关系，理解会在看不见的地方扎根。', task: '回头解释一个以前只会照写的步骤。' },
  { title: '😇', luck: '末吉', outlook: '好事来得稍晚，宜回头复盘，忌急着求成。', text: '昨天的问题，可能是今天的灵感。', task: '翻开一篇旧笔记，补上一句新的理解。' },
  { title: '😀', luck: '大吉', outlook: '行动正当时，给期待已久的小计划一个机会。', text: '今天适合动手。让一个小想法真的跑起来。', task: '完成一个只需要十分钟的小实验。' },
  { title: '🫣', luck: '凶', outlook: '思路容易打结，宜拆小问题，忌同时开太多坑。', text: '卡住的时候，换个角度，路也许就在旁边。', task: '用纸笔画出当前问题的输入和输出。' },
  { title: '😁', luck: '中吉', outlook: '分享有回响，适合交流心得、结识同好。', text: '把收获分享出去，也是在为别人留下一粒种子。', task: '整理一条愿意公开分享的小经验。' },
  { title: '🤔', luck: '凶', outlook: '絶望（ぜつぼう）と、仲良（なか よ）く。', text: '', task: '阅读科幻小说' },
  { title: '😑', luck: '大凶', outlook: '今日不宜硬刚，宜备份、休息，忌熬夜大改。', text: '休息也是生长的一部分，给自己一点空白。', task: '离开屏幕走一走，再回来读一段代码。' },
  { title: '😉', luck: '小吉', outlook: '积累渐成形，适合整理线索、串起新旧知识。', text: '零散的知识，正在慢慢连成你的地图。', task: '找出今天所学和旧知识的一处联系。' },
  { title: '😊', luck: '大吉', outlook: '同行添好运，带着问题去交流，或能豁然开朗。', text: '一句提问，或许能让两个人都向前一步。', task: '读一篇别人的公开练习，带走一个想法。' },
  { title: '😋', luck: '平', outlook: '稳步向前，完成一件小事也值得为自己高兴。', text: '不用每天都惊艳，持续的小步也会走得很远。', task: '给明天的自己留下一个具体的小目标。' },
]

export function fortuneError(error) {
  return ['PGRST202', '42883'].includes(error?.code)
    ? '签到功能正在准备中，稍后再来看看。'
    : '暂时无法读取数据，请稍后重试。'
}
