import type { PanInfo } from 'motion/react'
import { MOBILE } from './platform'

/**
 * 右侧滑出的侧页在手机上可以往右划回去关掉（用户要求）：横向拖动跟手，松手时划过 90px 或甩得够快就关，否则弹回。
 * 只锁横向（dragDirectionLock），竖着滑照常滚动正文；桌面端不开，免得拖选文字时把侧页拖走。
 * 用法：<motion.aside {...swipeToClose(onClose)} …>
 */
export function swipeToClose(onClose: () => void) {
  if (!MOBILE) return {}
  return {
    drag: 'x' as const,
    dragDirectionLock: true,
    dragConstraints: { left: 0, right: 0 },
    dragElastic: { left: 0, right: 1 },
    dragMomentum: false,
    onDragEnd: (_: unknown, info: PanInfo) => {
      if (info.offset.x > 90 || info.velocity.x > 500) onClose()
    }
  }
}
