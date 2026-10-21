import { OutlineWord, Reveal } from '@renderer/components/Type'

// 内核已就绪（services/classroom.ts 的 listSlides / getTranscript），界面待接
const TOOLS = ['课件提取', '课堂转写']

export function Tools() {
  return (
    <div className="page">
      <OutlineWord text="Tools" />
      <Reveal className="mt-24 max-w-3xl">
        <ul className="rows border-t border-[var(--rule)]">
          {TOOLS.map((name) => (
            <li key={name} className="row !grid-cols-1 opacity-45">
              <span className="row-title">{name}</span>
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  )
}
