import { AudioLines, Presentation, type LucideIcon } from 'lucide-react'
import { Card, PageHeader, Stagger, StaggerItem } from '@renderer/components/ui'

const TOOLS: { title: string; desc: string; icon: LucideIcon }[] = [
  { title: '直播课 PPT 提取', desc: '从智云课堂直播 / 回放中抓取课件页面，导出为 PDF', icon: Presentation },
  { title: '课堂音频转文字', desc: '提取课程音频并转写为带时间轴的文字稿', icon: AudioLines }
]

export function Tools() {
  return (
    <>
      <PageHeader title="工具箱" subtitle="让上课更轻松的小工具" />
      <Stagger className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {TOOLS.map(({ title, desc, icon: Icon }) => (
          <StaggerItem key={title}>
            <Card className="flex gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <Icon size={20} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{title}</h3>
                  <span className="rounded-full border border-line px-2 py-px text-[11px] text-muted">即将推出</span>
                </div>
                <p className="mt-1 text-sm text-muted">{desc}</p>
              </div>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>
    </>
  )
}
