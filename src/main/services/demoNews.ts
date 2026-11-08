import type { NewsFeed, NewsHandlers, NewsItem, NewsSettings, SztzActivity, WereadState } from '@shared/news'
import { WEB_SOURCES } from './newsSources'

// 校园资讯的演示数据（ZJU_DEMO=1 / 安卓 --mode demo）：活动、通知、公众号与钉钉消息都是编的，不连任何站点。
// 官网来源表用真实的 newsSources（公开信息），条目标题虚构

const day = (offset: number, hm = '14:00'): string => {
  const d = new Date(Date.now() + offset * 86_400_000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${hm}:00+08:00`
}

const base = {
  aesthetic: false,
  labor: false,
  notes: '',
  contact: '王老师 0571-8795XXXX',
  poster: null,
  joined: false
}

const ACTIVITIES: SztzActivity[] = [
  {
    ...base,
    id: 'a1',
    title: '“声动紫金港”校园合唱专场',
    org: '艺术团',
    category: '文体活动（第二课堂）',
    type: '美育',
    aesthetic: true,
    start: day(3, '18:30'),
    end: day(3, '21:00'),
    signupStart: day(-4),
    signupEnd: day(2, '22:00'),
    place: '紫金港校区 小剧场',
    quota: 300,
    signed: 214,
    points: '0.5',
    intro: '面向全校学生的合唱专场演出，观演即可记点。入场请携带校园卡。',
    signup: '本平台报名',
    external: null
  },
  {
    ...base,
    id: 'a2',
    title: '西溪湿地生态志愿清理',
    org: '环境与资源学院团委',
    category: '志愿公益（第二课堂）',
    type: '劳育',
    labor: true,
    start: day(5, '08:30'),
    end: day(5, '12:00'),
    signupStart: day(-2),
    signupEnd: day(4, '12:00'),
    place: '西溪湿地东门集合',
    quota: 40,
    signed: 40,
    points: '1–1.5',
    intro: '协助湿地管理处清理步道垃圾、记录鸟类观测点。全程约 3.5 小时，提供往返校车。',
    notes: '请穿防滑鞋，自备水杯。',
    signup: '本平台报名',
    external: null,
    joined: true
  },
  {
    ...base,
    id: 'a3',
    title: '人工智能前沿讲座：从大模型到具身智能',
    org: '计算机科学与技术学院',
    category: '学术科创（第三课堂）',
    type: '学术讲座',
    start: day(1, '19:00'),
    end: day(1, '20:30'),
    signupStart: day(-6),
    signupEnd: day(1, '12:00'),
    place: '玉泉校区 曹光彪主楼 201',
    quota: null,
    signed: 389,
    points: '0.25',
    intro: '邀请校外学者介绍大模型与机器人结合的最新进展，现场问答。',
    signup: '不在本平台报名',
    external: '扫描海报二维码填写报名问卷；或发送「姓名+学号」至 ai-lecture@example.edu.cn，名额以回复邮件为准。'
  },
  {
    ...base,
    id: 'a4',
    title: '求是园定向越野赛',
    org: '体育与健康协会',
    category: '文体活动（第二课堂）',
    type: '体育',
    start: day(9, '13:30'),
    end: day(9, '17:00'),
    signupStart: day(1),
    signupEnd: day(7),
    place: '紫金港校区 东操场',
    quota: 120,
    signed: 0,
    points: '0.5–1',
    intro: '以 3 人小队为单位完成校园打卡点，按用时排名。',
    signup: '本平台报名',
    external: null
  },
  {
    ...base,
    id: 'a5',
    title: '社区科普进课堂：小学生科学实验课',
    org: '化学系研究生会',
    category: '社会实践（第四课堂）',
    type: '社会实践',
    start: day(-3, '09:00'),
    end: day(-3, '11:30'),
    signupStart: day(-14),
    signupEnd: day(-5),
    place: '三墩镇某小学',
    quota: 12,
    signed: 12,
    points: '1',
    intro: '为小学生设计并演示安全的趣味化学实验。',
    signup: '本平台报名',
    external: null
  }
]

const notice = (id: string, title: string, offset: number, from: string, text?: string): NewsItem => ({
  id: `sztz:tzgg:${id}`,
  kind: 'sztz',
  title,
  time: day(offset, '10:00'),
  from,
  url: 'https://sztz.zju.edu.cn/dekt/',
  ...(text ? { text } : {})
})

const SZTZ_NOTICES: NewsItem[] = [
  notice('n1', '关于 2026-2027 学年第一学期第二课堂记点审核的通知', -1, '素拓平台 团委', '各学院（系）：本学期记点审核将于第 16 周结束，请活动组织单位在活动结束后 7 天内提交参与名单……'),
  notice('n2', '素拓数智平台维护公告', -4, '素拓平台 系统管理员', '平台将于本周六 22:00–24:00 停机维护，期间无法报名与查看记点。'),
  notice('n3', '美育、劳育记点认定说明（修订）', -12, '素拓平台 团委')
]

const pickSources = WEB_SOURCES.slice(0, 40)
const TITLES = [
  '关于开展 2026 年度本科生国家奖学金评审工作的通知',
  '本周学术报告：拓扑材料中的新奇量子态',
  '关于做好 2026-2027 学年秋冬学期期末考试安排的通知',
  '第十八届“挑战杯”校内选拔赛报名启动',
  '研究生学业奖学金评定结果公示',
  '冬季学期选课补选时间安排',
  '关于举办 2027 届毕业生秋季双选会的通知',
  '心理健康月系列活动预告',
  '暑期海外交流项目第二批报名',
  '关于开展学生宿舍安全检查的通知',
  '本科生转专业工作安排',
  '学园“新生领航”讲座第三讲'
]
const WEB_ITEMS: NewsItem[] = TITLES.map((title, i) => {
  const s = pickSources[(i * 7) % pickSources.length]
  return { id: `web:${s.id}:${i}`, kind: 'web', title, url: s.url, time: day(-i, '09:00').slice(0, 10), from: `${s.org} · ${s.column}`, sourceId: s.id, audience: s.audience }
})

const WECHAT_ITEMS: NewsItem[] = [
  { id: 'wechat:demo:1', kind: 'wechat', title: '紫金港本周文艺演出一览', time: day(0, '08:00'), from: '浙大青年', url: 'https://mp.weixin.qq.com/' },
  { id: 'wechat:demo:2', kind: 'wechat', title: '图书馆期末延长开放时间', time: day(-1, '20:00'), from: '浙大图书馆', url: 'https://mp.weixin.qq.com/' },
  { id: 'wechat:demo:3', kind: 'wechat', title: '社团招新第二轮来了', time: day(-2, '12:00'), from: '浙大学生社团', url: 'https://mp.weixin.qq.com/' }
]

const DINGTALK_ITEMS: NewsItem[] = [
  {
    id: 'dingtalk:demo:1',
    kind: 'dingtalk',
    title: '【通知】请各位同学周五 18:00 前填写实习意向',
    text: '【通知】请各位同学周五 18:00 前填写实习意向问卷，地点：东三教学楼 205 现场答疑。逾期不再补录。',
    time: day(0, '16:20'),
    from: '2024 级专业群 · 王老师',
    sourceId: 'demo-g1'
  },
  {
    id: 'dingtalk:demo:2',
    kind: 'dingtalk',
    title: '关于期中教学检查的通知',
    text: '### 关于期中教学检查的通知\n各位同学：\n\n学院将于**第 9 周**开展期中教学检查，请注意以下事项：\n1. 周三前在[教学评价系统](https://example.com/)提交意见；\n2. 座谈会时间：周四 14:00，地点：东三 205；\n3. 有问题联系 `教务办`。\n\n> 逾期不再受理。\n\n---\n教务办公室',
    time: day(0, '10:05'),
    from: '工作通知:演示学院',
    sourceId: '10001:30003'
  },
  {
    id: 'dingtalk:demo:3',
    kind: 'dingtalk',
    title: '收到，谢谢老师',
    text: '收到，谢谢老师',
    time: day(0, '16:25'),
    from: '2024 级专业群 · 李同学',
    sourceId: 'demo-g1'
  },
  {
    id: 'dingtalk:demo:4',
    kind: 'dingtalk',
    title: '图片',
    text: '',
    time: day(-1, '09:12'),
    from: '概率论答疑群 · 助教',
    sourceId: 'demo-g2'
  },
  {
    id: 'dingtalk:demo:7',
    kind: 'dingtalk',
    title: '群公告：第三次作业截止日期为下周二晚上 10 点',
    text: '第三次作业截止日期为下周二晚上 10 点，请大家按时完成。答疑时间改到周四下午，地点不变。',
    time: day(-1, '09:15'),
    from: '概率论答疑群 · 王老师',
    sourceId: 'demo-g2'
  },
  {
    id: 'dingtalk:demo:5',
    kind: 'dingtalk',
    title: '第三次作业.pdf',
    text: '文件：第三次作业.pdf',
    time: day(-1, '09:10'),
    from: '概率论答疑群 · 助教',
    sourceId: 'demo-g2'
  },
  {
    id: 'dingtalk:demo:6',
    kind: 'dingtalk',
    title: '周六还去图书馆吗',
    text: '周六还去图书馆吗',
    time: day(-2, '21:40'),
    from: '张三 · 我',
    sourceId: '10001:20002'
  }
]

const feed = (items: NewsItem[], failed: NewsFeed['failed'] = [], hidden = 0): NewsFeed => ({ items, failed, hidden, fetchedAt: Date.now() })

const settings: NewsSettings = {
  sources: WEB_SOURCES.filter((s) => s.kind === 'office').map((s) => s.id),
  audience: 'all',
  dingtalk: false,
  dingtalkHidden: [] as string[]
}

const weread: WereadState = {
  status: 'signedOut',
  accounts: [
    { id: 'MP_WXS_0000000001', name: '浙大青年' },
    { id: 'MP_WXS_0000000002', name: '浙大图书馆' },
    { id: 'MP_WXS_0000000003', name: '浙大学生社团' }
  ]
}

export const demoNews: NewsHandlers = {
  'news:activities': async (keyword) => ACTIVITIES.filter((a) => !keyword || a.title.includes(keyword) || a.org.includes(keyword)),
  'news:sztzNotices': async () => feed(SZTZ_NOTICES),
  'news:web': async () =>
    feed(
      WEB_ITEMS,
      [
        { from: '本科生院 · 通知公告', message: 'WebVPN 登录失败' },
        { from: '团委 · 通知公告', message: 'WebVPN 登录失败' },
        { from: '综合服务网 · 教育教学', message: 'WebVPN 登录失败' },
        { from: '某学院 · 通知公告', message: '超时' }
      ],
      9
    ),
  'news:sources': async () => WEB_SOURCES,
  'news:article': async () => ({ title: '演示文章', text: '这是演示模式下的正文。\n真实模式下这里显示校内网页的正文文字。' }),
  'news:settings': async () => ({ ...settings }),
  'news:setSettings': async (patch) => {
    Object.assign(settings, patch)
    return { ...settings }
  },
  'news:weread': async () => ({ ...weread }),
  'news:wereadLogin': async () => Object.assign(weread, { status: 'ok' }),
  'news:wereadLogout': async () => Object.assign(weread, { status: 'signedOut' }),
  'news:wereadAdd': async () => {
    weread.accounts = [...weread.accounts, { id: `MP_WXS_${Date.now()}`, name: '新添加的公众号' }]
    return { ...weread }
  },
  'news:wereadRemove': async (id) => {
    weread.accounts = weread.accounts.filter((a) => a.id !== id)
    return { ...weread }
  },
  'news:wechat': async () => feed(weread.status === 'ok' ? WECHAT_ITEMS : []),
  'news:dingtalk': async () => {
    if (!settings.dingtalk) throw new Error('未开启')
    return feed(DINGTALK_ITEMS)
  }
}
