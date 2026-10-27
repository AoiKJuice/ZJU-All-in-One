// 钟鹰徽标（viewBox 200×200，中心 100,100）：粗外环 + 主题色浅底的表盘；右半边是几何化的求是鹰
// （倒三角、四层羽、朝右的鹰头），左半边是两根主题色指针，分针指向右翼翅尖的镜像。
// 软件图标 build/icon.svg 用同一组几何，颜色固定为求是蓝；改这里时同步那边并重跑 scripts/make-icon.cjs
export const EAGLE =
  'M100 58 L176 58 L168 70 Q164 76 156.2 76 L138.5 76 A2.5 2.5 0 0 0 138.5 81 L160.67 81 L152.67 93 Q148.67 99 140.87 99 L128.17 99 A2.5 2.5 0 0 0 128.17 104 L145.33 104 L137.33 116 Q133.33 122 125.53 122 L117.83 122 A2.5 2.5 0 0 0 117.83 127 L130 127 L100 172 Z'
export const HEAD = 'M100 61 L100 45 C100 35 108 28 117 29 C123 30 128 35 132 42 L120 45 L113 61 Z'

/** 钟鹰：颜色全部取主题变量，昼夜与主题色切换时随之变化；bare 时去掉外环与表盘底色，只留鹰与指针（主页衬底） */
export function Logo({ className, bare = false }: { className?: string; bare?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 200 200" aria-hidden="true">
      {!bare && (
        <>
          <circle cx="100" cy="100" r="91" fill="var(--paper)" />
          <circle cx="100" cy="100" r="91" fill="var(--shu)" fillOpacity="0.16" stroke="var(--ink)" strokeWidth="10" />
        </>
      )}
      <path d={EAGLE} fill="var(--ink)" />
      <path d={HEAD} fill="var(--ink)" />
      <line x1="100" y1="100" x2="40.48" y2="67.11" stroke="var(--shu)" strokeWidth="12" strokeLinecap="round" />
      <line x1="100" y1="100" x2="64.58" y2="126.1" stroke="var(--shu)" strokeWidth="14" strokeLinecap="round" />
      <circle cx="100" cy="100" r="9.5" fill="var(--shu)" />
    </svg>
  )
}
