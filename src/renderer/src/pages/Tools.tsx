import { OutlineWord } from '@renderer/components/Type'
import { Graduation } from '@renderer/components/Graduation'

/** 工具：课堂与学业工具；目前只有毕业自审 */
export function Tools() {
  return (
    <div className="page">
      <OutlineWord text="Tools" />
      <Graduation />
    </div>
  )
}
